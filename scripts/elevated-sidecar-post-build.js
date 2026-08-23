import { execFileSync } from 'node:child_process';
import { mkdirp } from 'mkdirp';
import copy from 'recursive-copy';
import { rimraf } from 'rimraf';

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
      targetDirectory + 'oyasumivr-elevated-sidecar.exe',
    ],
    { stdio: 'inherit' }
  );
}

main().catch((e) => {
  throw e;
});
