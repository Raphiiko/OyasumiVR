import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  return result.status ?? 1;
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const version = packageJson.version;

const files = [
  'package.json',
  'package-lock.json',
  'src-shared-ts/package.json',
  'src-core/tauri.conf.json',
  'src-core/Cargo.toml',
  'src-core/Cargo.lock',
  'src-elevated-sidecar/Cargo.toml',
  'src-elevated-sidecar/Cargo.lock',
  'src-shared-rust/Cargo.toml',
  'src-shared-rust/Cargo.lock',
].filter((file) => existsSync(file));

const addStatus = run('git', ['add', '--', ...files]);
if (addStatus !== 0) process.exit(addStatus);

const staged = spawnSync('git', ['diff', '--cached', '--quiet']);
if (staged.status === 0) {
  console.log(`No version changes to commit (already at v${version})`);
  process.exit(0);
}
if (staged.status !== 1) process.exit(1);

process.exit(run('git', ['commit', '-m', `chore: bump version to v${version}`]));
