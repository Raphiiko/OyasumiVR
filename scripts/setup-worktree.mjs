import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { crates } from './checks.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const worktree = resolve(git('rev-parse', '--show-toplevel'));
const main = resolve(dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir')));

if (worktree === main) {
  console.log('This is the main checkout. Nothing to set up.');
  process.exit(0);
}

const lock = (root) => readFileSync(join(root, 'package-lock.json'), 'utf8');
if (existsSync(join(worktree, 'node_modules'))) {
  console.log('node_modules: already present');
} else if (lock(worktree) !== lock(main)) {
  console.log('node_modules: package-lock.json differs from the main checkout, run npm ci');
} else {
  symlinkSync(join(main, 'node_modules'), join(worktree, 'node_modules'), 'junction');
  console.log(`node_modules: linked to ${main}`);
}

for (const crate of Object.values(crates)) {
  const from = join(main, crate, 'target');
  const to = join(worktree, crate, 'target');
  if (!existsSync(join(from, 'debug'))) continue;
  if (existsSync(to)) {
    console.log(`${crate}: target already present`);
    continue;
  }
  const skip = new Set(
    ['release', 'cargo-timings', join('debug', 'incremental')].map((p) => join(from, p))
  );
  const start = performance.now();
  try {
    cpSync(from, to, {
      recursive: true,
      preserveTimestamps: true,
      filter: (path) => !skip.has(path),
    });
    console.log(`${crate}: copied target in ${((performance.now() - start) / 1000).toFixed(1)} s`);
  } catch (error) {
    rmSync(to, { recursive: true, force: true });
    console.log(`${crate}: skipped, ${error.message}`);
  }
}
