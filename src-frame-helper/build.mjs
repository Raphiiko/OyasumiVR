import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readBuildFlavour } from '../scripts/build-flavour.js';

const target = 'aarch64-unknown-linux-gnu';

function build() {
  execFileSync('rustup', ['target', 'add', target], { stdio: 'inherit' });
  execFileSync(
    'cargo',
    [
      'zigbuild',
      '--manifest-path',
      'src-frame-helper/Cargo.toml',
      '--release',
      '--locked',
      '--target',
      `${target}.2.28`,
    ],
    { stdio: 'inherit' }
  );
}

try {
  build();
  for (const root of ['src-core', 'src-core/target/debug', 'src-core/target/release']) {
    if (!existsSync(root)) continue;
    const destination = `${root}/resources/frame-helper`;
    mkdirSync(destination, { recursive: true });
    copyFileSync(
      `src-frame-helper/target/${target}/release/oyasumivr-frame-helper`,
      `${destination}/oyasumivr-frame-helper`
    );
  }
} catch (error) {
  if (readBuildFlavour() !== 'Dev') throw error;
  console.warn(
    'Skipped the Steam Frame helper, so Steam Frame pairing cannot install it. ' +
      'See src-frame-helper/README.md for the build requirements.'
  );
}
