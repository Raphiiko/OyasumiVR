import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const crates = {
  core: 'src-core',
  'shared-rust': 'src-shared-rust',
  'elevated-sidecar': 'src-elevated-sidecar',
  'privileged-launcher': 'src-privileged-launcher',
  'memory-watch': 'src-memory-watch',
  'signing-tool': 'tools/sign-elevated-sidecar',
};

const node = (file, ...args) => [process.execPath, file, ...args];
const prettier = (...args) => node('node_modules/prettier/bin/prettier.cjs', ...args);
const webPaths = [
  'src-ui/**/*.{ts,js,mjs,html,css,scss,json}',
  'src-overlay-ui/**/*.{ts,js,mjs,html,css,scss,json}',
  'src-shared-ts/**/*.{ts,js,json}',
  'scripts/**/*.{ts,js,mjs,json}',
  'docs/translation_contributors.json',
  '*.{json,js,mjs,ts}',
  '.github/workflows/*.{yml,yaml}',
];

export const checks = {
  'format:web': { group: 'quality', command: prettier('--check', ...webPaths) },
  'lint:web': {
    group: 'quality',
    command: node(
      'node_modules/eslint/bin/eslint.js',
      'src-ui',
      'src-overlay-ui',
      'src-shared-ts',
      'scripts',
      'eslint.config.js',
      'vitest.config.ts'
    ),
  },
  'test:web': { group: 'quality', command: node('node_modules/vitest/vitest.mjs', 'run') },
  translations: { group: 'catalogs', command: node('scripts/check-translations.mjs') },
  'generated:readmes': { group: 'catalogs', command: node('scripts/check-readmes.mjs') },
  'build:ui': {
    group: 'frontend',
    command: node(
      'node_modules/@angular/cli/bin/ng.js',
      'build',
      'oyasumivr',
      '--configuration',
      'development'
    ),
  },
  'build:overlay-ui': {
    group: 'frontend',
    command: node(
      'node_modules/@angular/cli/bin/ng.js',
      'build',
      'overlay-ui',
      '--configuration',
      'development'
    ),
  },
  'format:csharp': {
    group: 'native',
    windows: true,
    command: [
      'dotnet',
      'format',
      'whitespace',
      'src-overlay-sidecar/oyasumivr-overlay-sidecar.csproj',
      '--verify-no-changes',
      '--exclude',
      'src-overlay-sidecar/openvr_api.cs',
    ],
  },
  'build:overlay-sidecar': {
    group: 'native',
    windows: true,
    command: [
      'dotnet',
      'build',
      'src-overlay-sidecar/oyasumivr-overlay-sidecar.csproj',
      '--configuration',
      'Debug',
    ],
  },
};

for (const [component, directory] of Object.entries(crates)) {
  for (const operation of ['format', 'lint', 'test', 'build']) {
    const args = {
      format: ['fmt', '--', '--check'],
      lint: ['clippy', '--locked', '--all-targets', '--', '-D', 'warnings'],
      test: ['test', '--locked'],
      build: ['build', '--locked'],
    }[operation];
    if (component === 'core' && operation !== 'format') args.splice(1, 0, '--no-default-features');
    checks[`${operation}:${component}`] = {
      group: 'native',
      windows: operation !== 'format',
      cwd: directory,
      command: ['cargo', ...args],
    };
  }
}

export function expandCheck(name = 'all') {
  if (checks[name]) return [name];
  const [operation, component] = name.split(':');
  const found = Object.keys(checks).filter((id) => {
    if (name === 'all') return true;
    if (name === 'quick') return ['quality', 'catalogs'].includes(checks[id].group);
    if (component === 'rust') return id.startsWith(`${operation}:`) && id.split(':')[1] in crates;
    return !component && id.startsWith(`${operation}:`);
  });
  if (!found.length) throw new Error(`Unknown check: ${name}`);
  return found;
}

export function runChecks(ids) {
  if (process.platform !== 'win32' && ids.some((id) => checks[id].windows)) {
    throw new Error(
      'These checks require Windows, the MSVC build tools, Rust, .NET 10, and protoc. Run check:quick for portable checks.'
    );
  }
  const failed = [];
  for (const id of ids) {
    const { command, cwd } = checks[id];
    console.log(`\nChecking ${id}`);
    const result = spawnSync(command[0], command.slice(1), { cwd, stdio: 'inherit' });
    if (result.error) console.error(result.error.message);
    if (result.status !== 0) failed.push(id);
  }
  if (failed.length) throw new Error(`Failed checks: ${failed.join(', ')}`);
  console.log(`\nPassed ${ids.length} checks.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runChecks(expandCheck(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
