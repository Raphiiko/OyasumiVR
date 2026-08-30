import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirp } from 'mkdirp';
import copy from 'recursive-copy';
import { rimraf } from 'rimraf';
import { readBuildFlavour } from './build-flavour.js';

function updaterPublicKey() {
  const path = 'src-core/tauri.conf.json';
  const key = JSON.parse(readFileSync(path).toString())?.plugins?.updater?.pubkey;
  if (!key) throw new Error(`Could not read plugins.updater.pubkey from ${path}`);
  return key;
}

async function main() {
  const source = 'src-elevated-sidecar/target/release/';
  const targetDirectory = 'src-core/resources/elevated-sidecar/';
  await rimraf(targetDirectory);
  await mkdirp(targetDirectory);
  await copy(source, targetDirectory, {
    overwrite: true,
    filter: ['oyasumivr-elevated-sidecar.exe'],
  });

  // writes <exe>.minisig next to the sidecar, and fails the build for a shippable flavour
  execFileSync(
    'cargo',
    [
      'run',
      '--release',
      '--quiet',
      '--manifest-path',
      'tools/sign-elevated-sidecar/Cargo.toml',
      '--',
      `--flavour=${readBuildFlavour()}`,
      `--public-key=${updaterPublicKey()}`,
      targetDirectory + 'oyasumivr-elevated-sidecar.exe',
    ],
    { stdio: 'inherit' }
  );
}

main().catch((e) => {
  throw e;
});
