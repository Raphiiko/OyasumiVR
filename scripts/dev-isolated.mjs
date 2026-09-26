import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { basename } from 'node:path';
import tauri from '@tauri-apps/cli';

const worktree = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const name = basename(worktree)
  .toLowerCase()
  .replace(/[^a-z0-9-]+/g, '-');
const identifier = `co.raphii.oyasumi.dev.${name}`;

const isFree = (port) =>
  new Promise((resolve) => {
    const server = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => server.close(() => resolve(true)));
    server.listen(port);
  });

// start from a port derived from the identifier, so a worktree usually keeps its ports
let uiPort = 4300 + (createHash('sha1').update(identifier).digest().readUInt16BE(0) % 500);
while (!((await isFree(uiPort)) && (await isFree(uiPort + 5000)))) uiPort++;
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
