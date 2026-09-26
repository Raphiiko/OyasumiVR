import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';
import tauri from '@tauri-apps/cli';

const worktree = resolve(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
);
const name = basename(worktree)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-');
const pathHash = createHash('sha1').update(worktree.toLowerCase()).digest('hex').slice(0, 8);
const identifier = `co.raphii.oyasumi.dev.${name}-${pathHash}`;

// resolves to the listening server, null when the port is taken, false when the host has no such address
const listen = (port, host) =>
  new Promise((done) => {
    const server = createServer()
      .once('error', (error) => done(error.code === 'EADDRNOTAVAIL' ? false : null))
      .once('listening', () => done(server));
    server.listen(port, host);
  });

// ng serve listens on ::1 and CDP on 127.0.0.1, and Windows lets a wildcard bind succeed beside both
const isFree = async (port) => {
  for (const host of ['127.0.0.1', '::1']) {
    const server = await listen(port, host);
    if (server === null) return false;
    if (server) await new Promise((done) => server.close(done));
  }
  return true;
};

// hold a claim port for the whole session, so two launches never pick the same ports
let uiPort = 4300 + (createHash('sha1').update(identifier).digest().readUInt16BE(0) % 500);
let claim = null;
for (; ; uiPort++) {
  claim = await listen(uiPort + 10000, '127.0.0.1');
  if (!claim) continue;
  if ((await isFree(uiPort)) && (await isFree(uiPort + 5000))) break;
  claim.close();
}
claim.unref();
const cdpPort = uiPort + 5000;

process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${cdpPort}`;
console.log(
  `[dev-isolated] identifier=${identifier} ui=http://localhost:${uiPort} cdp=${cdpPort} data=%APPDATA%\\${identifier}`
);

await tauri.run(
  [
    'dev',
    '--config',
    JSON.stringify({
      identifier,
      build: {
        devUrl: `http://localhost:${uiPort}`,
        beforeDevCommand: `npm run start:ui -- --port ${uiPort}`,
      },
    }),
    ...process.argv.slice(2),
  ],
  'tauri'
);
