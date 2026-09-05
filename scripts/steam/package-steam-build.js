import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

// Both depots get the same STEAM build. The Chinese depot carries a marker file, which switches
// OyasumiVR to CN compliance mode at runtime.
const DEPOTS = {
  STEAM: { contentDir: 'Win64' },
  STEAM_CN: { contentDir: 'Win64_CN', cnRelease: true },
};

const EXECUTABLE_NAME = 'OyasumiVR.exe';
const CN_MARKER_NAME = 'cn_release';

const depotArg = (process.argv[2] || '').toUpperCase();
if (!DEPOTS[depotArg]) {
  console.error('Usage: node scripts/steam/package-steam-build.js <STEAM|STEAM_CN>');
  process.exit(1);
}

const buildTs = readFileSync('src-ui/build.ts', 'utf8');
const flavourMatch = buildTs.match(/export const FLAVOUR: BuildFlavour = '([A-Z_]+)';/);
if (!flavourMatch) {
  console.error('Could not read build flavour from src-ui/build.ts');
  process.exit(1);
}
const currentFlavour = flavourMatch[1];
if (currentFlavour !== 'STEAM') {
  console.error(
    `Current build flavour is ${currentFlavour}, but Steam depots need the STEAM flavour. ` +
      'Run `npm run set-flavour STEAM` and rebuild before packaging.'
  );
  process.exit(1);
}

const releaseDir = join('src-core', 'target', 'release');
const debugDir = join('src-core', 'target', 'debug');
let sourceDir;
if (existsSync(join(releaseDir, EXECUTABLE_NAME))) {
  sourceDir = releaseDir;
} else if (existsSync(join(debugDir, EXECUTABLE_NAME))) {
  sourceDir = debugDir;
} else {
  console.error(
    `Could not find ${EXECUTABLE_NAME} in src-core/target/{release,debug}/. ` +
      `Run \`npm run tauri -- build --no-bundle\` first.`
  );
  process.exit(1);
}

const { contentDir, cnRelease } = DEPOTS[depotArg];
const outputDir = join('dist', 'steam', contentDir);

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const buildArtifacts = [EXECUTABLE_NAME, 'openvr_api.dll', 'steam_api64.dll'];
for (const file of buildArtifacts) {
  const src = join(sourceDir, file);
  if (!existsSync(src)) {
    console.error(`Required build artifact not found: ${src}`);
    process.exit(1);
  }
  copyFileSync(src, join(outputDir, file));
}

const resourcesSrc = join(sourceDir, 'resources');
if (existsSync(resourcesSrc)) {
  cpSync(resourcesSrc, join(outputDir, 'resources'), { recursive: true });
}

if (cnRelease) {
  writeFileSync(join(outputDir, CN_MARKER_NAME), '');
}

console.log(`Packaged Steam ${depotArg} build to ${outputDir}`);
