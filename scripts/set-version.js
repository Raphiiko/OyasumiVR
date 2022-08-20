const { readFileSync, writeFileSync } = require('fs');
let { semver } = require('check-more-types');

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
  return;
}
const version = process.argv[2];
if (!semver(version)) {
  console.error('Provided version is not valid semver format');
  process.exit(1);
  return;
}

const packageJson = JSON.parse(readFileSync('package.json').toString());
packageJson.version = version;
writeFileSync('package.json', JSON.stringify(packageJson, null, 2));

const tauriConfJson = JSON.parse(readFileSync('src-tauri/tauri.conf.json').toString());
tauriConfJson.package.version = version;
writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(tauriConfJson, null, 2));

let cargoToml = readFileSync('src-tauri/Cargo.toml').toString();
cargoToml = cargoToml.replaceAll(
  /\[package\]\r?\nname = "oyasumi"\r?\nversion = "[0-9]+\.[0-9]+\.[0-9]+"/g,
  `[package]\r\nname = "oyasumi"\r\nversion = "${version}"`
);
writeFileSync('src-tauri/Cargo.toml', cargoToml);

console.log(`Set all versions to v${version}.`);
