//
// Runs the secret storage cases that need the real app: the real DPAPI, the real store plugin, and
// the real migration on startup. Unit tests cover the pure logic, `npm test` runs those.
//
// Usage: node scripts/test-secrets-e2e.mjs [--keep-server]
//
// It backs up the app data directory before the first write and restores it at the end, including
// when a case fails. The dev server on port 4200 is started when it is not already listening.
//

import { spawn, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const APP_DATA = join(process.env.APPDATA, 'co.raphii.oyasumi');
const STORE = join(APP_DATA, 'settings.dat');
const BACKUP = join(tmpdir(), 'oyasumivr-e2e-backup');
const BINARY = 'src-core/target/debug/oyasumivr.exe';
const CDP_PORT = 9222;
const DEV_URL = 'http://localhost:4200';

const MASTER_KEY = 'mY2BEtChq6dmPS4byAT2Xr1NT+tet5IONT+o7Eni3Vw=';
const KEYS = {
  app: 'APP_SETTINGS',
  pulsoid: 'PULSOID_API',
  automations: 'AUTOMATION_CONFIGS',
  vrchat: 'VRCHAT_API',
};

const results = [];
let currentCase = '';

function check(description, condition, detail = '') {
  results.push({ case: currentCase, description, passed: !!condition, detail });
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${description}${condition || !detail ? '' : ` -> ${detail}`}`);
}

// legacy storage format

const toBase64 = (buffer) => Buffer.from(buffer).toString('base64');
const fromBase64 = (value) => Buffer.from(value, 'base64');

async function masterKey() {
  return crypto.subtle.importKey('raw', fromBase64(MASTER_KEY), { name: 'AES-GCM' }, true, [
    'wrapKey',
    'unwrapKey',
  ]);
}

async function createLegacyKey() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('raw', key, await masterKey(), {
    name: 'AES-GCM',
    iv,
    tagLength: 128,
  });
  return { key, serialized: `${toBase64(wrapped)}$${toBase64(iv)}` };
}

async function legacyEncrypt(key, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(data)
  );
  return `${toBase64(encrypted)}$${toBase64(iv)}`;
}

const legacyCredentials = (key, username, password) =>
  legacyEncrypt(
    key,
    `${Buffer.from(username).toString('base64')}:${Buffer.from(password).toString('base64')}`
  );

// DPAPI, through the same API the app uses

function dpapiUnprotect(blob) {
  const script = `
    Add-Type -AssemblyName System.Security
    $bytes = [Convert]::FromBase64String('${blob}')
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))`;
  return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
}

const isDpapi = (value) => typeof value === 'string' && value.startsWith('AQAAANCMnd8');

// the store

const readStore = () => JSON.parse(readFileSync(STORE, 'utf8'));

function writeStore(contents) {
  mkdirSync(APP_DATA, { recursive: true });
  writeFileSync(STORE, JSON.stringify(contents, null, 2));
}

// Seeds exactly what a case asks for, so no real secret of the user is ever part of a test run
function seed(overrides) {
  writeStore(overrides);
}

// the app

async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(description, predicate, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function startDevServer() {
  if (await reachable(DEV_URL)) return null;
  console.log('Starting the dev server on 4200');
  const server = spawn('npm', ['run', 'start:ui'], { shell: true, stdio: 'ignore' });
  await waitFor('the dev server', () => reachable(DEV_URL), 300000);
  return server;
}

async function launchApp() {
  const log = openSync(join(tmpdir(), 'oyasumivr-e2e-app.log'), 'a');
  const app = spawn(BINARY, ['--core-mode', 'dev', '--overlay-sidecar-mode', 'dev'], {
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
  });
  await waitFor('the app window', async () => {
    const page = await cdpPage();
    if (!page) return false;
    return (await evaluate(page, `!!document.querySelector('app-root')`)) === true;
  });
  return app;
}

function stopApp(app) {
  try {
    execFileSync('taskkill', ['/PID', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    app.kill('SIGKILL');
  }
}

// CDP

async function cdpPage() {
  try {
    const targets = await (
      await fetch(`http://127.0.0.1:${CDP_PORT}/json`, { signal: AbortSignal.timeout(1000) })
    ).json();
    return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl) ?? null;
  } catch {
    return null;
  }
}

async function evaluate(page, expression) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    const response = await new Promise((resolve, reject) => {
      socket.onmessage = (event) => resolve(JSON.parse(event.data));
      socket.onerror = reject;
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        })
      );
      setTimeout(() => reject(new Error('CDP evaluate timed out')), 30000);
    });
    return response.result?.result?.value;
  } finally {
    socket.close();
  }
}

// cases

async function caseMigrateEverything() {
  currentCase = 'migrates every store on startup';
  const commandKey = await createLegacyKey();
  const credentialKey = await createLegacyKey();
  seed({
    [KEYS.automations]: {
      version: 19,
      RUN_AUTOMATIONS: {
        enabled: true,
        onSleepModeEnable: true,
        runAutomationsCryptoKey: commandKey.serialized,
        onSleepModeEnableCommands: await legacyEncrypt(commandKey.key, 'echo e2e-enable'),
      },
    },
    [KEYS.app]: { version: 11, mqttPassword: 'e2e-mqtt-password' },
    [KEYS.pulsoid]: { version: 1, accessToken: 'e2e-pulsoid-token', expiresAt: 4000000000 },
    [KEYS.vrchat]: {
      version: 6,
      activeProfileId: 'e2e-profile',
      legacyCredentialCryptoKey: credentialKey.serialized,
      profiles: [
        {
          id: 'e2e-profile',
          sourceProfileId: null,
          restoreProfileId: null,
          userId: 'usr_e2e',
          username: 'e2e',
          displayName: 'E2E',
          draft: false,
          authCookie: 'e2e-auth-cookie',
          rememberCredentials: true,
          rememberedCredentials: await legacyCredentials(
            credentialKey.key,
            'e2e@example.invalid',
            'e2e-pw'
          ),
        },
      ],
    },
  });

  const app = await launchApp();
  await waitFor('the migrations to land', async () => readStore()[KEYS.vrchat]?.version === 7);
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const store = readStore();
  stopApp(app);

  check('automation configs reach version 20', store[KEYS.automations].version === 20);
  check(
    'the command is plain text',
    store[KEYS.automations].RUN_AUTOMATIONS.onSleepModeEnableCommands === 'echo e2e-enable',
    store[KEYS.automations].RUN_AUTOMATIONS.onSleepModeEnableCommands
  );
  check(
    'the command key is gone',
    !('runAutomationsCryptoKey' in store[KEYS.automations].RUN_AUTOMATIONS)
  );
  check('app settings reach version 12', store[KEYS.app].version === 12);
  check('the MQTT password is not plain text', store[KEYS.app].mqttPassword === null);
  check(
    'the MQTT password is protected',
    isDpapi(store[KEYS.app].mqttProtectedPassword) &&
      dpapiUnprotect(store[KEYS.app].mqttProtectedPassword) === 'e2e-mqtt-password'
  );
  check('Pulsoid settings reach version 2', store[KEYS.pulsoid].version === 2);
  check('the Pulsoid token is not plain text', store[KEYS.pulsoid].accessToken === undefined);
  check(
    'the Pulsoid token is protected',
    isDpapi(store[KEYS.pulsoid].protectedAccessToken) &&
      dpapiUnprotect(store[KEYS.pulsoid].protectedAccessToken) === 'e2e-pulsoid-token'
  );
  check('VRChat settings reach version 7', store[KEYS.vrchat].version === 7);
  check('the credential key is gone', !('legacyCredentialCryptoKey' in store[KEYS.vrchat]));
  const profile = store[KEYS.vrchat].profiles.find((p) => p.id === 'e2e-profile');
  check('the profile secret is protected', isDpapi(profile?.protectedSecret));
  const secret = profile ? JSON.parse(dpapiUnprotect(profile.protectedSecret)) : {};
  check(
    'the credentials survived the migration',
    secret.rememberedCredentials?.username === 'e2e@example.invalid' &&
      secret.rememberedCredentials?.password === 'e2e-pw'
  );
  check('the auth cookie survived', secret.authCookie === 'e2e-auth-cookie');
  check(
    'no plain secret is left in the file',
    !readFileSync(STORE, 'utf8').includes('e2e-pw') &&
      !readFileSync(STORE, 'utf8').includes('e2e-mqtt-password')
  );
  return store;
}

async function caseSecondLaunchChangesNothing(previous) {
  currentCase = 'a second launch changes no secret';
  const app = await launchApp();
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const store = readStore();
  stopApp(app);

  check(
    'no store is migrated again',
    store[KEYS.vrchat].version === 7 && store[KEYS.app].version === 12
  );
  check(
    'the MQTT blob is unchanged',
    store[KEYS.app].mqttProtectedPassword === previous[KEYS.app].mqttProtectedPassword
  );
  check(
    'the Pulsoid blob is unchanged',
    store[KEYS.pulsoid].protectedAccessToken === previous[KEYS.pulsoid].protectedAccessToken
  );
  check(
    'the command is unchanged',
    store[KEYS.automations].RUN_AUTOMATIONS.onSleepModeEnableCommands === 'echo e2e-enable'
  );
}

async function caseUnreadableBlobsSurvive() {
  currentCase = 'an unreadable secret is kept, not overwritten';
  const garbage = Buffer.from('not a dpapi blob at all').toString('base64');
  seed({
    [KEYS.app]: { version: 12, mqttPassword: null, mqttProtectedPassword: garbage },
    [KEYS.pulsoid]: {
      version: 2,
      protectedAccessToken: garbage,
      expiresAt: 4000000000,
      username: 'e2e',
    },
  });

  const app = await launchApp();
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const store = readStore();
  stopApp(app);

  check('the MQTT blob is untouched', store[KEYS.app].mqttProtectedPassword === garbage);
  check('no plain MQTT password is written', store[KEYS.app].mqttPassword === null);
  check('the Pulsoid blob is untouched', store[KEYS.pulsoid].protectedAccessToken === garbage);
  check('the Pulsoid username survives', store[KEYS.pulsoid].username === 'e2e');
}

async function caseEncryptedCommandWithoutKey() {
  currentCase = 'an encrypted command with no key never becomes a command';
  const { key } = await createLegacyKey();
  seed({
    [KEYS.automations]: {
      version: 19,
      RUN_AUTOMATIONS: {
        enabled: true,
        onSleepModeEnable: true,
        onSleepModeEnableCommands: await legacyEncrypt(key, 'echo e2e-should-never-run'),
      },
    },
  });

  const app = await launchApp();
  await waitFor('the migration to land', async () => readStore()[KEYS.automations]?.version === 20);
  const store = readStore();
  stopApp(app);

  check(
    'the command is empty',
    store[KEYS.automations].RUN_AUTOMATIONS.onSleepModeEnableCommands === '',
    store[KEYS.automations].RUN_AUTOMATIONS.onSleepModeEnableCommands
  );
}

async function caseIdleWritesNothing() {
  currentCase = 'an idle app writes no secret and does not reconnect in a loop';
  seed({
    [KEYS.app]: {
      version: 12,
      mqttEnabled: true,
      mqttHost: 'test-mqtt-host.invalid',
      mqttPort: 1883,
      mqttPassword: null,
      mqttProtectedPassword: null,
    },
    [KEYS.pulsoid]: { version: 2, protectedAccessToken: null },
    [KEYS.automations]: {
      version: 20,
      RUN_AUTOMATIONS: { enabled: true, onSleepModeEnableCommands: 'echo e2e-idle' },
    },
  });

  const app = await launchApp();
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const before = readStore();
  await new Promise((resolve) => setTimeout(resolve, 60000));
  const after = readStore();
  stopApp(app);

  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
  check(
    'no secret changes while idle',
    !changed.includes(KEYS.app) &&
      !changed.includes(KEYS.pulsoid) &&
      !changed.includes(KEYS.automations),
    `changed: ${changed.join(', ') || 'nothing'}`
  );
  console.log(`  (idle writes, none of them secrets: ${changed.join(', ') || 'none'})`);
}

async function caseMqttModalRoundTrip() {
  currentCase = 'the MQTT modal stores what was typed';
  seed({ [KEYS.app]: { version: 12, mqttPassword: null, mqttProtectedPassword: null } });
  const app = await launchApp();
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const typed = 'e2e-typed-password';
  const written = await evaluate(
    await cdpPage(),
    `(async () => {
       const holder = [...document.querySelectorAll('*')]
         .map((element) => {
           try {
             return window.ng.getComponent(element);
           } catch {
             return null;
           }
         })
         .filter(Boolean)
         .flatMap((component) => Object.values(component))
         .find((value) => value && typeof value.updateSettings === 'function' && 'settingsSync' in value);
       if (!holder) return 'no settings service';
       holder.updateSettings({ mqttPassword: ${JSON.stringify(typed)} });
       await new Promise((r) => setTimeout(r, 2000));
       return 'ok';
     })()`
  );
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const store = readStore();
  stopApp(app);

  check('the settings view is reachable', written === 'ok', String(written));
  check('the typed password is protected', isDpapi(store[KEYS.app].mqttProtectedPassword));
  check(
    'the typed password round trips',
    isDpapi(store[KEYS.app].mqttProtectedPassword) &&
      dpapiUnprotect(store[KEYS.app].mqttProtectedPassword) === typed
  );
  check('no plain password is written', store[KEYS.app].mqttPassword === null);
}

// runner

// Another instance makes the launched one exit through the single instance plugin, and it would
// write its own state over a seeded store
function runningInstances() {
  const list = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' });
  return list
    .split(/\r?\n/)
    .filter((line) => /^"oyasumivr/i.test(line))
    .map((line) => line.split('","')[0].replace('"', ''));
}

async function main() {
  if (!existsSync(BINARY)) {
    console.error(`No dev build at ${BINARY}. Run: npm run start:ui, then build the core once.`);
    process.exit(2);
  }
  const running = runningInstances();
  if (running.length) {
    console.error(`Close OyasumiVR first, it is running: ${running.join(', ')}`);
    console.error('A second instance exits immediately, and the running one overwrites the store.');
    process.exit(2);
  }
  if (existsSync(BACKUP)) rmSync(BACKUP, { recursive: true, force: true });
  cpSync(APP_DATA, BACKUP, { recursive: true });
  console.log(`Backed up the app data to ${BACKUP}`);

  const server = await startDevServer();
  try {
    const migrated = await caseMigrateEverything();
    await caseSecondLaunchChangesNothing(migrated);
    await caseUnreadableBlobsSurvive();
    await caseEncryptedCommandWithoutKey();
    await caseMqttModalRoundTrip();
    await caseIdleWritesNothing();
  } finally {
    rmSync(APP_DATA, { recursive: true, force: true });
    cpSync(BACKUP, APP_DATA, { recursive: true });
    console.log(`Restored the app data from ${BACKUP}`);
    if (server && !process.argv.includes('--keep-server')) {
      execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    }
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const result of failed) console.log(`  FAIL ${result.case}: ${result.description}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((cause) => {
  console.error(cause);
  if (existsSync(BACKUP)) {
    rmSync(APP_DATA, { recursive: true, force: true });
    cpSync(BACKUP, APP_DATA, { recursive: true });
    console.error('Restored the app data after the failure');
  }
  process.exit(1);
});
