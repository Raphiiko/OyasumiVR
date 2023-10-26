import { readFileSync, writeFileSync } from 'fs';
import { semver } from 'check-more-types';

if (process.argv.length <= 2) {
  console.error('Please provide a version');
  process.exit(1);
}
let version = process.argv[2];
if (!semver(version)) {
  console.error('Provided version from id semver format');
  process.exit(1);
}

// 1-prepare-steam-sdk.sh
{
  const path = 'scripts/steam/1-prepare-steam-sdk.sh';
  let contents = readFileSync(path).toString();
  contents = contents.replaceAll(
    /[0-9]+[.][0-9]+[.][0-9]+\/dotnet-hosting-[0-9]+[.][0-9]+[.][0-9]+-win[.]exe/g,
    `${version}/dotnet-hosting-${version}-win.exe`
  );
  contents = contents.replaceAll(
    /\/dotnet-hosting-[0-9]+[.][0-9]+[.][0-9]+-win[.]exe/g,
    `/dotnet-hosting-${version}-win.exe`
  );
  writeFileSync(path, contents);
  console.log('Updated ' + path);
}

// runtime_dependencies.vdf
{
  const path = 'scripts/steam/install-scripts/runtime_dependencies.vdf';
  let contents = readFileSync(path).toString();
  contents = contents.replaceAll(
    /dotnet-hosting-[0-9]+[.][0-9]+[.][0-9]+-win[.]exe/g,
    `dotnet-hosting-${version}-win.exe`
  );
  writeFileSync(path, contents);
  console.log('Updated ' + path);
}

// globals.rs
{
  const path = 'src-core/src/globals.rs';
  let contents = readFileSync(path).toString();
  contents = contents.replaceAll(
    /pub const DOTNET_CORE_VERSION: &str = "[0-9]+[.][0-9]+[.][0-9]+";/g,
    `pub const DOTNET_CORE_VERSION: &str = "${version}";`
  );
  contents = contents.replaceAll(
    /pub const ASPNET_CORE_VERSION: &str = "[0-9]+[.][0-9]+[.][0-9]+";/g,
    `pub const ASPNET_CORE_VERSION: &str = "${version}";`
  );
  writeFileSync(path, contents);
  console.log('Updated ' + path);
}

console.log(`Set all dotnet versions to v${version}.`);
