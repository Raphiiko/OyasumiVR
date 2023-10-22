import { readdirSync, readFileSync, writeFileSync } from 'fs';

if (process.argv.length <= 2) {
  console.error('Please provide a flavour (DEV, STANDALONE, STEAM, STEAM_CN)');
  process.exit(1);
}

const flavour = process.argv[2].toUpperCase();
if (!['DEV', 'STANDALONE', 'STEAM', 'STEAM_CN'].includes(flavour)) {
  console.error('Provided flavour is not valid (DEV, STANDALONE, STEAM, STEAM_CN)');
  process.exit(1);
}

// Determine flavour derivations
let appKey = (() => {
  switch (flavour) {
    case 'DEV':
      return 'steam.overlay.2538150-DEV';
    case 'STANDALONE':
      return 'steam.overlay.2538150-STANDALONE';
    case 'STEAM':
      return 'steam.overlay.2538150-STEAM';
    case 'STEAM_CN':
      return 'steam.overlay.2538150-STEAM';
    default:
      console.warn('COULD NOT DETERMINE APP KEY FROM FLAVOUR');
      return 'steam.overlay.2538150-DEV';
  }
})();

// Set Main UI flavour
{
  const path = 'src-ui/build.ts';
  let uiFlavour = readFileSync(path).toString();
  uiFlavour = uiFlavour.replaceAll(
    /export const FLAVOUR: BuildFlavour = '(DEV|STANDALONE|STEAM|STEAM_CN)';/g,
    `export const FLAVOUR: BuildFlavour = '${flavour}';`
  );
  writeFileSync(path, uiFlavour);
  console.log(path);
}

// Set Core flavour
{
  const path = 'src-core/src/flavour.rs';
  let coreFlavour = readFileSync(path).toString();
  coreFlavour = coreFlavour.replaceAll(
    /pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::(Dev|Standalone|Steam|SteamCn);/g,
    `pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::${flavour
      .split('_')
      .map((t) => t.toUpperCase().charAt(0) + t.toLowerCase().substring(1))
      .join('')};`
  );
  writeFileSync(path, coreFlavour);
  console.log('Updated ' + path);
}

// Set flavour of vr manifest
{
  const path = 'src-core/resources/manifest.vrmanifest';
  let manifest = JSON.parse(readFileSync(path).toString());
  manifest['applications'].forEach((app) => {
    app['app_key'] = appKey;
  });
  writeFileSync(path, JSON.stringify(manifest, null, 2));
  console.log('Updated ' + path);
}

// Set flavour of default input profiles
{
  const basePath = 'src-core/resources/input';
  readdirSync(basePath).forEach((file) => {
    const path = basePath + '/' + file;
    const contents = JSON.parse(readFileSync(path).toString());
    if (!contents['app_key']) return;
    contents['app_key'] = appKey;
    writeFileSync(path, JSON.stringify(contents, null, 2));
    console.log('Updated ' + path);
  });
}
