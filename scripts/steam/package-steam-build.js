import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

// Both depots get the same STEAM build. The Chinese depot carries a marker file, which switches
// OyasumiVR to CN compliance mode at runtime.
const DEPOTS = {
  STEAM: { contentDir: 'Win64' },
  STEAM_CN: { contentDir: 'Win64_CN', cnRelease: true },
};

const WEBVIEW2_INSTALLER_URL = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
const WEBVIEW2_INSTALLER_NAME = 'WebView2RuntimeInstaller.exe';
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

const cacheDir = join('dist', 'steam', '.cache');
const cachedInstaller = join(cacheDir, WEBVIEW2_INSTALLER_NAME);
if (!existsSync(cachedInstaller)) {
  mkdirSync(cacheDir, { recursive: true });
  console.log(`Downloading WebView2 runtime installer from ${WEBVIEW2_INSTALLER_URL} ...`);
  const result = spawnSync('curl', ['-L', '-o', cachedInstaller, WEBVIEW2_INSTALLER_URL], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    console.error(`Failed to launch curl: ${result.error.message}`);
    process.exit(1);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    console.error(`curl exited with status ${result.status}`);
    process.exit(result.status);
  }
}

const webView2Dir = join(outputDir, 'WebView2');
mkdirSync(webView2Dir, { recursive: true });
copyFileSync(cachedInstaller, join(webView2Dir, WEBVIEW2_INSTALLER_NAME));

copyFileSync(
  join('scripts', 'steam', 'install-scripts', 'runtime_dependencies.vdf'),
  join(outputDir, 'runtime_dependencies.vdf')
);

if (cnRelease) {
  writeFileSync(join(outputDir, CN_MARKER_NAME), '');
}

console.log(`Packaged Steam ${depotArg} build to ${outputDir}`);
