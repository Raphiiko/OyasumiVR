import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';

const buildId =
  readFileSync('src-ui/build.ts', 'utf8').match(/BUILD_ID = '([^']+)'/)?.[1] ?? 'unknown';
execFileSync(
  'cargo',
  ['build', '--manifest-path', 'src-memory-watch/Cargo.toml', '--release', '--locked'],
  {
    stdio: 'inherit',
    env: { ...process.env, OYASUMIVR_BUILD_ID: buildId },
  }
);
for (const root of ['src-core', 'src-core/target/debug', 'src-core/target/release']) {
  if (!existsSync(root)) continue;
  const destination = `${root}/resources/memory-watch`;
  mkdirSync(destination, { recursive: true });
  copyFileSync(
    'src-memory-watch/target/release/oyasumivr-memory-watch.exe',
    `${destination}/oyasumivr-memory-watch.exe`
  );
}
