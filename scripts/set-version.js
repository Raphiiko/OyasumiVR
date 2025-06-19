import { readFileSync, writeFileSync } from 'fs';
import { semver } from 'check-more-types';

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
}
let version = process.argv[2];
if (version !== 'DEV' && !semver(version)) {
  console.error('Provided version is not a valid semver');
  process.exit(1);
}

if (version === 'DEV') version = '0.0.0';

// UI package json
{
  const packageJson = JSON.parse(readFileSync('package.json').toString());
  packageJson.version = version;
  writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
}

// Shared TS package json
{
  const packageJson = JSON.parse(readFileSync('src-shared-ts/package.json').toString());
  packageJson.version = version;
  writeFileSync('src-shared-ts/package.json', JSON.stringify(packageJson, null, 2));
}

// Overlay UI package json
{
  const packageJson = JSON.parse(readFileSync('src-overlay-ui/package.json').toString());
  packageJson.version = version;
  writeFileSync('src-overlay-ui/package.json', JSON.stringify(packageJson, null, 2));
}

// Tauri config json
const tauriConfJson = JSON.parse(readFileSync('src-core/tauri.conf.json').toString());
tauriConfJson.version = version;
tauriConfJson.app.windows = tauriConfJson.app.windows.map((window) => {
  window.userAgent = `OyasumiVR/${
    version === '0.0.0' ? 'DEV' : version
  } (https://github.com/Raphiiko/OyasumiVR)`;
  return window;
});
writeFileSync('src-core/tauri.conf.json', JSON.stringify(tauriConfJson, null, 2));

// Core Cargo toml
let tauriCargoToml = readFileSync('src-core/Cargo.toml').toString();
tauriCargoToml = tauriCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr"\r\nversion = "${version}"`
);
writeFileSync('src-core/Cargo.toml', tauriCargoToml);

// Elevated sidecar cargo toml
let adminCargoToml = readFileSync('src-elevated-sidecar/Cargo.toml').toString();
adminCargoToml = adminCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr-elevated-sidecar"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr-elevated-sidecar"\r\nversion = "${version}"`
);
writeFileSync('src-elevated-sidecar/Cargo.toml', adminCargoToml);

// Shared Cargo toml
let sharedCargoToml = readFileSync('src-shared-rust/Cargo.toml').toString();
sharedCargoToml = sharedCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr-shared"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr-shared"\r\nversion = "${version}"`
);
writeFileSync('src-shared-rust/Cargo.toml', sharedCargoToml);

console.log(`Set all versions to v${version}.`);
