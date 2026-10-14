import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const REPOSITORY = 'Raphiiko/OyasumiVR';
// The updater endpoint in src-core/tauri.conf.json reads this gist file.
const UPDATE_MANIFEST_GIST = '16ed38d8ccd9282675d04478f887f76f';
const UPDATE_MANIFEST_FILE = 'oyasumi_update_manifest.json';
const BUNDLE_DIR = join('src-core', 'target', 'release', 'bundle', 'nsis');
const OUTPUT_DIR = join('dist', 'standalone');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) fail(`${command} ${args[0]} ${args[1] ?? ''} failed`);
  return result;
}

/** Returns the body of the CHANGELOG.md section for `version`, without its heading. */
function changelogNotes(version) {
  const lines = readFileSync('CHANGELOG.md', 'utf8').split(/\r?\n/u);
  const start = lines.findIndex((line) => line.trim() === `## [${version}]`);
  if (start < 0) fail(`CHANGELOG.md has no "## [${version}]" section.`);
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim();
}

// check the version, flavour and commit
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) {
  fail(
    `Version "${version}" is not a stable version. The standalone channel only gets stable ` +
      `releases. Set one first, e.g.: npm run set-version ${version.split('-')[0]}`
  );
}
if (!readFileSync('src-ui/build.ts', 'utf8').includes("FLAVOUR: BuildFlavour = 'STANDALONE'")) {
  fail('The build flavour is not STANDALONE. Run `npm run build:standalone:release` first.');
}
run('git', ['fetch', '--quiet', 'origin', 'main']);
const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
if (spawnSync('git', ['merge-base', '--is-ancestor', commit, 'origin/main']).status !== 0) {
  fail(`HEAD (${commit}) is not on origin/main. Push the release commit to main first.`);
}

// collect the installer and the updater artifacts
const tag = `oyasumivr-v${version}`;
const installer = `OyasumiVR_${version}_x64-setup.exe`;
const legacyBundle = `OyasumiVR_${version}_x64-setup.nsis.zip`;
const assets = [installer, `${installer}.sig`, legacyBundle, `${legacyBundle}.sig`].map((file) =>
  join(BUNDLE_DIR, file)
);
for (const asset of assets) {
  if (!existsSync(asset)) fail(`Missing ${asset}. Run \`npm run build:standalone:release\`.`);
}

// write the update manifest
const notes = changelogNotes(version);
const download = (file) => `https://github.com/${REPOSITORY}/releases/download/${tag}/${file}`;
const signature = (file) => readFileSync(join(BUNDLE_DIR, `${file}.sig`), 'utf8');
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    // updaters from before Tauri 2 can only install the zipped bundle
    'windows-x86_64': { signature: signature(legacyBundle), url: download(legacyBundle) },
    'windows-x86_64-nsis': { signature: signature(installer), url: download(installer) },
  },
};
mkdirSync(OUTPUT_DIR, { recursive: true });
const manifestPath = join(OUTPUT_DIR, 'latest.json');
const notesPath = join(OUTPUT_DIR, 'release-notes.md');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(notesPath, notes + '\n');

// publish the release, then point the updater at it
run('gh', [
  'release',
  'create',
  tag,
  ...assets,
  manifestPath,
  '--repo',
  REPOSITORY,
  '--target',
  commit,
  '--title',
  `OyasumiVR v${version}`,
  '--notes-file',
  notesPath,
]);
run('gh', ['api', '--method', 'PATCH', `gists/${UPDATE_MANIFEST_GIST}`, '--input', '-'], {
  input: JSON.stringify({
    files: { [UPDATE_MANIFEST_FILE]: { content: readFileSync(manifestPath, 'utf8') } },
  }),
  stdio: ['pipe', 'ignore', 'inherit'],
});

console.log(`Published ${tag} and updated the update manifest.`);
