import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { basename, join, resolve } from 'path';

const APP_ID = '2538150';
const DEPOTS = {
  STEAM: { id: '2538151', contentDir: 'Win64' },
  STEAM_CN: { id: '2538152', contentDir: 'Win64_CN' },
};
const LOCAL_ENV_FILE = '.env.local';
const EXECUTABLE_NAME = 'OyasumiVR.exe';
const LIVE_BRANCHES = { alpha: 'alpha', beta: 'beta', release: '' };

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;
  const fileContents = readFileSync(filePath, 'utf8');
  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) continue;
    let value = line.slice(separatorIndex + 1).trim();
    const isWrappedInQuotes =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isWrappedInQuotes) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

function escapeVdf(value) {
  return value.replaceAll('\\', '\\\\');
}

function toVdfPath(path) {
  return escapeVdf(resolve(path));
}

const modeArg = (process.argv[2] || '').toLowerCase();
if (!Object.hasOwn(LIVE_BRANCHES, modeArg)) {
  fail('Usage: node scripts/steam/upload-steam-build.js <alpha|beta|release>');
}

loadLocalEnv(LOCAL_ENV_FILE);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.version) fail('Could not read version from package.json');
const packageVersion = packageJson.version;
const isPrerelease = /^[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.-]+$/.test(packageVersion);
if (modeArg === 'beta' && !isPrerelease) {
  fail(
    `Version "${packageVersion}" has no prerelease suffix. ` +
      `Set one before uploading a beta build, e.g.: npm run set-version ${packageVersion}-beta.1`
  );
}
if (modeArg === 'release' && isPrerelease) {
  fail(
    `Version "${packageVersion}" still carries a prerelease suffix. ` +
      `Set the release version first, e.g.: npm run set-version ${packageVersion.split('-')[0]}`
  );
}

const buildTs = readFileSync('src-ui/build.ts', 'utf8');
const buildIdMatch = buildTs.match(/export const BUILD_ID = '([^']+)';/);
if (!buildIdMatch) fail('Could not read BUILD_ID from src-ui/build.ts');
const buildId = buildIdMatch[1];

for (const [flavour, { contentDir }] of Object.entries(DEPOTS)) {
  const exe = join('dist', 'steam', contentDir, EXECUTABLE_NAME);
  if (!existsSync(exe)) {
    fail(
      `Expected packaged Steam build not found for ${flavour}: ${exe}. ` +
        `Run \`npm run build:steam:${modeArg}\` first.`
    );
  }
}

const steamCmdPath = process.env.STEAMCMD_PATH || 'steamcmd';
const steamUsername = process.env.STEAM_USERNAME;
if (!steamUsername) fail('Missing required environment variable: STEAM_USERNAME');
const steamPassword = process.env.STEAM_PASSWORD;
const steamGuardCode = process.env.STEAM_GUARD_CODE;
const setLiveBranch = process.env.STEAM_SET_LIVE_BRANCH || LIVE_BRANCHES[modeArg];
const preview = process.env.STEAM_PREVIEW === '1' ? '1' : '0';
const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
const buildDescription =
  process.env.STEAM_BUILD_DESC ||
  (modeArg === 'alpha'
    ? `OyasumiVR alpha build ${buildId} ${timestamp} UTC`
    : `OyasumiVR v${packageVersion} build ${buildId} ${timestamp} UTC`);

const generatedRoot = join('dist', 'steamcmd');
const buildOutputDir = join(generatedRoot, 'output');
const vdfDir = join(generatedRoot, 'vdf');

rmSync(vdfDir, { recursive: true, force: true });
mkdirSync(buildOutputDir, { recursive: true });
mkdirSync(vdfDir, { recursive: true });

const depotEntries = [];
for (const { id, contentDir } of Object.values(DEPOTS)) {
  const depotVdfPath = join(vdfDir, `depot_${id}.vdf`);
  const depotVdf = `"DepotBuildConfig"
{
  "DepotID" "${id}"
  "ContentRoot" "${toVdfPath(join('dist', 'steam', contentDir))}"

  "FileMapping"
  {
    "LocalPath" "*"
    "DepotPath" "."
    "recursive" "1"
  }

  "FileExclusion" "*.pdb"
}
`;
  writeFileSync(depotVdfPath, depotVdf);
  depotEntries.push({ id, fileName: basename(depotVdfPath) });
}

const appBuildVdfPath = join(vdfDir, `app_${APP_ID}.vdf`);
const appBuildVdf = `"appbuild"
{
  "appid" "${APP_ID}"
  "desc" "${escapeVdf(buildDescription)}"
  "buildoutput" "${toVdfPath(buildOutputDir)}"
  "contentroot" "${toVdfPath(join('dist', 'steam'))}"
  "setlive" "${escapeVdf(setLiveBranch)}"
  "preview" "${preview}"

  "depots"
  {
${depotEntries.map(({ id, fileName }) => `    "${id}" "${fileName}"`).join('\n')}
  }
}
`;
writeFileSync(appBuildVdfPath, appBuildVdf);

console.log(`Prepared Steam upload (${modeArg})`);
console.log(`App ID: ${APP_ID}`);
console.log(`Description: ${buildDescription}`);
console.log(`App build VDF: ${resolve(appBuildVdfPath)}`);

const steamCmdArgs = ['+login', steamUsername];
if (steamPassword) {
  steamCmdArgs.push(steamPassword);
  if (steamGuardCode) steamCmdArgs.push(steamGuardCode);
}
steamCmdArgs.push('+run_app_build', resolve(appBuildVdfPath), '+quit');

const result = spawnSync(steamCmdPath, steamCmdArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) fail(`Failed to launch steamcmd: ${result.error.message}`);
if (typeof result.status === 'number' && result.status !== 0) {
  process.exit(result.status);
}
