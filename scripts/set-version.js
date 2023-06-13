import { readFileSync, writeFileSync } from 'fs';
import { semver } from 'check-more-types';

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
}
let version = process.argv[2];
if (version !== 'DEV' && !semver(version)) {
  console.error('Provided version from id semver format');
  process.exit(1);
}

const packageJson = JSON.parse(readFileSync('package.json').toString());
packageJson.version = version;
writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

if (version === 'DEV') version = '0.0.0';

// Tauri config json
const tauriConfJson = JSON.parse(readFileSync('src-tauri/tauri.conf.json').toString());
tauriConfJson.package.version = version;
tauriConfJson.tauri.windows = tauriConfJson.tauri.windows.map((window) => {
  window.userAgent = `OyasumiVR/${
    version === '0.0.0' ? 'DEV' : version
  } (https://github.com/Raphiiko/OyasumiVR)`;
  return window;
});
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConfJson, null, 2));

// Tauri cargo toml
let tauriCargoToml = readFileSync('src-tauri/Cargo.toml').toString();
tauriCargoToml = tauriCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr"\r\nversion = "${version}"`
);
writeFileSync('src-tauri/Cargo.toml', tauriCargoToml);

// Elevated sidecar cargo toml
let adminCargoToml = readFileSync('src-elevated-sidecar/Cargo.toml').toString();
adminCargoToml = adminCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr-elevated-sidecar"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr-elevated-sidecar"\r\nversion = "${version}"`
);
writeFileSync('src-elevated-sidecar/Cargo.toml', adminCargoToml);

// Shared cargo toml
let sharedCargoToml = readFileSync('src-shared/Cargo.toml').toString();
sharedCargoToml = sharedCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumivr-shared"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumivr-shared"\r\nversion = "${version}"`
);
writeFileSync('src-shared/Cargo.toml', sharedCargoToml);

console.log(`Set all versions to v${version}.`);
