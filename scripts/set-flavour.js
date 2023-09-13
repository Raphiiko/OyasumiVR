import { readFileSync, writeFileSync } from 'fs';

if (process.argv.length <= 2) {
  console.error('Please provide a flavour (DEV, STANDALONE, STEAM, STEAM_CN)');
  process.exit(1);
}

const flavour = process.argv[2].toUpperCase();
if (!['DEV', 'STANDALONE', 'STEAM', 'STEAM_CN'].includes(flavour)) {
  console.error('Provided flavour is not valid (DEV, STANDALONE, STEAM, STEAM_CN)');
  process.exit(1);
}

{
  let uiFlavour = readFileSync('src-ui/build.ts').toString();
  uiFlavour = uiFlavour.replaceAll(
    /export const FLAVOUR: BuildFlavour = '(DEV|STANDALONE|STEAM|STEAM_CN)';/g,
    `export const FLAVOUR: BuildFlavour = '${flavour}';`
  );
  writeFileSync('src-ui/build.ts', uiFlavour);
  console.log('Updated src-ui/build.ts');
}

{
  let coreFlavour = readFileSync('src-core/src/flavour.rs').toString();
  coreFlavour = coreFlavour.replaceAll(
    /pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::(Dev|Standalone|Steam|SteamCn);/g,
    `pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::${flavour
      .split('_')
      .map((t) => t.toUpperCase().charAt(0) + t.toLowerCase().substring(1))
      .join('')};`
  );
  writeFileSync('src-core/src/flavour.rs', coreFlavour);
  console.log('Updated src-core/src/flavour.rs');
}
