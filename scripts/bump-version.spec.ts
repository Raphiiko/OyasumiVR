import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.each(['beta', 'release'])('keeps local package versions synchronized for %s bumps', (mode) => {
  const directory = mkdtempSync(join(tmpdir(), 'oyasumi-version-test-'));
  try {
    for (const path of [
      'scripts/bump-version.js',
      'scripts/set-version.js',
      'package-lock.json',
      'src-shared-ts/package.json',
      'src-core/tauri.conf.json',
      'src-core/Cargo.toml',
      'src-elevated-sidecar/Cargo.toml',
      'src-privileged-launcher/Cargo.toml',
      'src-shared-rust/Cargo.toml',
    ]) {
      cpSync(path, join(directory, path));
    }
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ type: 'module', version: '26.8.0-beta.6' })
    );
    writeFileSync(join(directory, 'CHANGELOG.md'), '## [Unreleased]\n');
    const result = spawnSync(process.execPath, ['scripts/bump-version.js', mode], {
      cwd: directory,
      env: { ...process.env, BUMP_NOW: '2026-09-07T00:00:00Z' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const readJson = (path: string) => JSON.parse(readFileSync(join(directory, path), 'utf8'));
    const version = readJson('package.json').version;
    const lock = readJson('package-lock.json');
    expect(version).toBe(mode === 'beta' ? '26.9.0-beta.7' : '26.9.0');
    expect(lock.version).toBe(version);
    expect(lock.packages[''].version).toBe(version);
    expect(lock.packages['src-shared-ts'].version).toBe(version);
    expect(readJson('src-shared-ts/package.json').version).toBe(version);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
