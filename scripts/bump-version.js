import { readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';

const mode = (process.argv[2] || '').toLowerCase();
if (!['beta', 'release'].includes(mode)) {
  console.error('Usage: node scripts/bump-version.js <beta|release>');
  process.exit(1);
}

const now = process.env.BUMP_NOW ? new Date(process.env.BUMP_NOW) : new Date();
const year = String(now.getUTCFullYear() % 100);
const month = String(now.getUTCMonth() + 1);

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.version) {
  console.error('Could not read version from package.json');
  process.exit(1);
}
const currentVersion = packageJson.version;

const changelog = readFileSync('CHANGELOG.md', 'utf8');
if (mode === 'release' && !changelog.includes('## [Unreleased]')) {
  console.error(
    'CHANGELOG.md has no ## [Unreleased] section, the release appears to have been cut already'
  );
  process.exit(1);
}
const stablesThisMonth = [...changelog.matchAll(/^## \[(\d+)\.(\d+)\.\d+\]/gm)].filter(
  ([, y, m]) => y === year && m === month
).length;

let version;
if (mode === 'beta') {
  const betaMatch = currentVersion.match(/-beta\.(\d+)$/);
  const betaNumber = betaMatch ? Number(betaMatch[1]) + 1 : 1;
  version = `${year}.${month}.${stablesThisMonth}-beta.${betaNumber}`;
} else {
  version = `${year}.${month}.${stablesThisMonth}`;
}

console.log(
  `Bumping v${currentVersion} to v${version} (${stablesThisMonth} stable release(s) in ${year}.${month} so far)`
);

const result = spawnSync(process.execPath, ['scripts/set-version.js', version], {
  stdio: 'inherit',
});
if (result.error || result.status !== 0) process.exit(result.status ?? 1);

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
lock.version = version;
if (lock.packages?.['']) lock.packages[''].version = version;
writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

if (mode === 'release') {
  writeFileSync('CHANGELOG.md', changelog.replace('## [Unreleased]', `## [${version}]`));
  console.log(`Renamed the changelog's [Unreleased] section to [${version}]`);
  console.log(
    'Next: commit the release, merge it to master, then run "npm run deploy:steam:release"'
  );
}
