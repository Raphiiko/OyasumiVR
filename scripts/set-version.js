const { readFileSync, writeFileSync } = require('fs');
let { semver } = require('check-more-types');

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
  return;
}
let version = process.argv[2];
if (version !== 'DEV' && !semver(version)) {
  console.error('Provided version is not valid semver format');
  process.exit(1);
  return;
}

const packageJson = JSON.parse(readFileSync('package.json').toString());
packageJson.version = version;
writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

if (version === 'DEV') version = '0.0.0';

const tauriConfJson = JSON.parse(readFileSync('src-tauri/tauri.conf.json').toString());
tauriConfJson.package.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConfJson, null, 2));

let tauriCargoToml = readFileSync('src-tauri/Cargo.toml').toString();
tauriCargoToml = tauriCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumi"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumi"\r\nversion = "${version}"`
);
writeFileSync('src-tauri/Cargo.toml', tauriCargoToml);

let adminCargoToml = readFileSync('src-elevated-sidecar/Cargo.toml').toString();
adminCargoToml = adminCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumi-elevated-sidecar"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumi-elevated-sidecar"\r\nversion = "${version}"`
);
writeFileSync('src-elevated-sidecar/Cargo.toml', adminCargoToml);

let sharedCargoToml = readFileSync('src-shared/Cargo.toml').toString();
sharedCargoToml = sharedCargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumi-shared"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumi-shared"\r\nversion = "${version}"`
);
writeFileSync('src-shared/Cargo.toml', sharedCargoToml);

console.log(`Set all versions to v${version}.`);
