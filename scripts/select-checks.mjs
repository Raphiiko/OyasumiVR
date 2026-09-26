import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checks, checkName, crates } from './checks.mjs';

const all = Object.keys(checks);
const web = ['format:web', 'lint:web', 'test:web'];
const frontend = ['build:ui', 'build:overlay-ui'];
const webTestInputs = new Set([
  'src-ui/assets/i18n/en.json',
  'src-core/tauri.conf.json',
  'src-core/Cargo.toml',
  'src-elevated-sidecar/Cargo.toml',
  'src-frame-helper/Cargo.toml',
  'src-privileged-launcher/Cargo.toml',
  'src-shared-rust/Cargo.toml',
]);
const rust = (components) =>
  components.flatMap((c) => ['format', 'lint', 'test', 'build'].map((op) => `${op}:${c}`));

export function selectChecks(files, fileExists = existsSync) {
  const selected = new Set();
  const add = (...ids) => ids.flat().forEach((id) => selected.add(id));
  for (const path of files) {
    if (webTestInputs.has(path)) add('test:web');
    if (
      /^(package(-lock)?\.json|angular\.json|tsconfig.*\.json|eslint\.config\.js|vitest\.config\.ts|rust-toolchain\.toml|global\.json|\.prettier.*|\.editorconfig|\.gitattributes|\.npmrc)$/.test(
        path
      ) ||
      path.startsWith('.github/workflows/') ||
      path.startsWith('scripts/')
    )
      return all;
    if (path.startsWith('src-ui/assets/i18n/')) {
      add('format:web', 'translations');
      if (!fileExists(path)) add('build:overlay-ui');
    } else if (path === 'docs/translation_contributors.json') {
      add(web, 'build:ui', 'generated:readmes');
    } else if (path.startsWith('docs/readmes/') || path === 'README.md') {
      add('generated:readmes');
    } else if (path.startsWith('src-shared-ts/') || path.startsWith('src-grpc-web-client/')) {
      add(web, frontend);
    } else if (['src-ui/build.ts', 'src-ui/flavour.ts'].includes(path)) {
      add(web, frontend, rust(['core', 'memory-watch']));
    } else if (path.startsWith('src-ui/')) {
      add(web, 'build:ui');
    } else if (path.startsWith('src-overlay-ui/')) {
      add(web, 'build:overlay-ui');
    } else if (path.startsWith('proto/')) {
      add(web, frontend, rust(['core', 'elevated-sidecar']), 'build:overlay-sidecar');
    } else if (path.startsWith('src-overlay-sidecar/')) {
      add('format:csharp', 'build:overlay-sidecar');
    } else {
      const component = Object.keys(crates).find((name) => path.startsWith(`${crates[name]}/`));
      if (component) {
        add(
          rust(
            component === 'shared-rust'
              ? ['shared-rust', 'core', 'elevated-sidecar', 'privileged-launcher']
              : [component]
          )
        );
        if (path === 'src-core/tauri.conf.json') add(rust(['signing-tool']));
      } else if (
        /^(docs\/|\.agents\/|AGENTS\.md$|CLAUDE\.md$|CHANGELOG\.md$|LICENSE\.md$|\.gitignore$|\.coderabbit\.yaml$)/.test(
          path
        )
      ) {
        continue;
      } else {
        return all;
      }
    }
  }
  return all.filter((id) => selected.has(id));
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

export async function comparisonBase(event) {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    return git('merge-base', event.pull_request.base.sha, event.pull_request.head.sha);
  }
  if (process.env.GITHUB_EVENT_NAME !== 'push') return null;
  const branch = process.env.GITHUB_REF_NAME;
  const url = new URL(
    `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/checks.yml/runs`
  );
  url.search = new URLSearchParams({ branch, event: 'push', status: 'success', per_page: '100' });
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!response.ok)
    throw new Error(`Cannot read previous successful checks: HTTP ${response.status}`);
  for (const run of (await response.json()).workflow_runs) {
    if (String(run.id) === process.env.GITHUB_RUN_ID) continue;
    try {
      git('merge-base', '--is-ancestor', run.head_sha, process.env.GITHUB_SHA);
      return run.head_sha;
    } catch {
      continue;
    }
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let selected = all;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const base = await comparisonBase(event);
    if (base) {
      const head = event.pull_request?.head.sha ?? process.env.GITHUB_SHA;
      const files = git('diff', '--name-only', '--no-renames', '-z', base, head)
        .split('\0')
        .filter(Boolean);
      selected = selectChecks(files);
      console.log(`Comparing ${base} to ${head}: ${files.length} changed files.`);
    } else console.log('No trusted comparison available; checking everything.');
  } catch (error) {
    console.log(`${error.message}; checking everything.`);
  }
  const priority = (id) => (id.startsWith('format:') ? 0 : id.startsWith('lint:') ? 1 : 2);
  const matrix = [...selected]
    .sort((left, right) => priority(left) - priority(right))
    .map((id) => {
      const [operation, component = ''] = id.split(':');
      const rust = Object.hasOwn(crates, component);
      return {
        id,
        name: checkName(id),
        key: id.replaceAll(':', '-'),
        runner: checks[id].windows ? 'windows-2025' : 'ubuntu-24.04',
        npm: checks[id].group !== 'native',
        dotnet: component === 'csharp' || component === 'overlay-sidecar',
        rust,
        compile: rust && operation !== 'format',
        saveCache: rust && operation === 'build',
        component,
        directory: crates[component] ?? '',
      };
    });
  const outputs = { selected, matrix };
  for (const [key, value] of Object.entries(outputs)) {
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${JSON.stringify(value)}\n`);
  }
  console.log(JSON.stringify(outputs, null, 2));
}
