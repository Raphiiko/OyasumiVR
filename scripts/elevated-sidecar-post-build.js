import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { readBuildFlavour } from './build-flavour.js';

function updaterPublicKey() {
  const path = 'src-core/tauri.conf.json';
  const key = JSON.parse(readFileSync(path, 'utf8'))?.plugins?.updater?.pubkey;
  if (!key) throw new Error(`Could not read plugins.updater.pubkey from ${path}`);
  return key;
}

const SIDECAR_EXE = 'oyasumivr-elevated-sidecar.exe';
const LAUNCHER_EXE = 'oyasumivr-privileged-launcher.exe';

async function place(source, targetDirectory, file) {
  await rm(targetDirectory, { recursive: true, force: true });
  await mkdir(targetDirectory, { recursive: true });
  await copyFile(source + file, targetDirectory + file);
}

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

async function main() {
  const sidecarDirectory = 'src-core/resources/elevated-sidecar/';
  await place('src-elevated-sidecar/target/release/', sidecarDirectory, SIDECAR_EXE);

  // the launcher ships alongside the sidecar, and refuses to run one it cannot verify
  run('cargo', ['build', '--release', '--manifest-path', 'src-privileged-launcher/Cargo.toml']);
  await place(
    'src-privileged-launcher/target/release/',
    'src-core/resources/privileged-launcher/',
    LAUNCHER_EXE
  );

  // writes <exe>.minisig next to the sidecar, and fails the build for a shippable flavour
  run('cargo', [
    'run',
    '--release',
    '--quiet',
    '--manifest-path',
    'tools/sign-elevated-sidecar/Cargo.toml',
    '--',
    `--flavour=${readBuildFlavour()}`,
    `--public-key=${updaterPublicKey()}`,
    sidecarDirectory + SIDECAR_EXE,
  ]);
}

main().catch((e) => {
  throw e;
});
