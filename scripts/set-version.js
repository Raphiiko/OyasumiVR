import { readFileSync, writeFileSync } from 'fs';

const VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
}
let version = process.argv[2];
if (version !== 'DEV' && !VERSION_PATTERN.test(version)) {
  console.error(
    'Provided version is not valid semver, expected e.g. "25.6.12" or "26.8.0-beta.1" ' +
      '(no leading zeroes, e.g. "26.8" rather than "26.08")'
  );
  process.exit(1);
}

if (version === 'DEV') version = '0.0.0';

// UI package json
{
  const packageJson = JSON.parse(readFileSync('package.json').toString());
  packageJson.version = version;
  writeFileSync('package.json', JSON.stringify(packageJson, null, 2) + '\n');
}

// Shared TS package json
{
  const packageJson = JSON.parse(readFileSync('src-shared-ts/package.json').toString());
  packageJson.version = version;
  writeFileSync('src-shared-ts/package.json', JSON.stringify(packageJson, null, 2) + '\n');
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
writeFileSync('src-core/tauri.conf.json', JSON.stringify(tauriConfJson, null, 2) + '\n');

// Core Cargo toml
let tauriCargoToml = readFileSync('src-core/Cargo.toml').toString();
tauriCargoToml = tauriCargoToml.replaceAll(
  /\[package\](\r?\n)name = "oyasumivr"\1version = "[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"/g,
  `[package]$1name = "oyasumivr"$1version = "${version}"`
);
writeFileSync('src-core/Cargo.toml', tauriCargoToml);

// Elevated sidecar cargo toml
let adminCargoToml = readFileSync('src-elevated-sidecar/Cargo.toml').toString();
adminCargoToml = adminCargoToml.replaceAll(
  /\[package\](\r?\n)name = "oyasumivr-elevated-sidecar"\1version = "[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"/g,
  `[package]$1name = "oyasumivr-elevated-sidecar"$1version = "${version}"`
);
writeFileSync('src-elevated-sidecar/Cargo.toml', adminCargoToml);

// Privileged launcher cargo toml
let launcherCargoToml = readFileSync('src-privileged-launcher/Cargo.toml').toString();
launcherCargoToml = launcherCargoToml.replaceAll(
  /\[package\](\r?\n)name = "oyasumivr-privileged-launcher"\1version = "[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"/g,
  `[package]$1name = "oyasumivr-privileged-launcher"$1version = "${version}"`
);
if (!launcherCargoToml.includes(`version = "${version}"`)) {
  throw new Error(
    'Could not set the version in src-privileged-launcher/Cargo.toml. The [package] block may have been reordered.'
  );
}
writeFileSync('src-privileged-launcher/Cargo.toml', launcherCargoToml);

// Shared Cargo toml
let sharedCargoToml = readFileSync('src-shared-rust/Cargo.toml').toString();
sharedCargoToml = sharedCargoToml.replaceAll(
  /\[package\](\r?\n)name = "oyasumivr-shared"\1version = "[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"/g,
  `[package]$1name = "oyasumivr-shared"$1version = "${version}"`
);
writeFileSync('src-shared-rust/Cargo.toml', sharedCargoToml);

console.log(`Set all versions to v${version}.`);
