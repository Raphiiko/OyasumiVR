import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checks, checkName, runChecks } from './checks.mjs';
import { checkResult, jobsPassed, readResults, summary } from './report-checks.mjs';

const temporary: string[] = [];
const temp = () => {
  const path = mkdtempSync(join(tmpdir(), 'oyasumi-check-results-'));
  temporary.push(path);
  return path;
};
afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

it('names every command with a distinct status', () => {
  const names = Object.keys(checks).map(checkName);
  expect(new Set(names).size).toBe(names.length);
  expect(
    names.every((name) => /^(Formatting|Lint|Tests|Build|Validity|Up-to-date): /.test(name))
  ).toBe(true);
  const report = summary([], []);
  expect(report.indexOf('Build: Main UI')).toBeLessThan(report.indexOf('Formatting: Rust core'));
  expect(report.indexOf('Formatting: Rust core')).toBeLessThan(report.indexOf('Lint: Web'));
  expect(names.some((name) => name.includes('undefined'))).toBe(false);
  expect(checkName('translations')).toBe('Validity: Translation files');
  expect(checkName('generated:readmes')).toBe('Up-to-date: Generated READMEs');
  expect(checkName('build:overlay-ui')).toBe('Build: Overlay UI');
});

it('requires every selected execution and result job to succeed', () => {
  const selected = ['test:web', 'test:core'];
  const jobs = Object.fromEntries(
    ['select', 'portable', 'native-execution', 'native-results'].map((id) => [
      id,
      { result: 'success' },
    ])
  );
  expect(jobsPassed(jobs, selected)).toBe(true);
  for (const id of Object.keys(jobs)) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(jobsPassed({ ...jobs, [id]: { result } }, selected)).toBe(false);
    }
  }
  expect(jobsPassed({ ...jobs, portable: { result: 'skipped' } }, ['test:core'])).toBe(true);
  expect(
    jobsPassed(
      {
        ...jobs,
        'native-execution': { result: 'skipped' },
        'native-results': { result: 'skipped' },
      },
      ['test:web']
    )
  ).toBe(true);
  expect(
    jobsPassed(
      {
        select: { result: 'success' },
        portable: { result: 'skipped' },
        'native-execution': { result: 'skipped' },
        'native-results': { result: 'skipped' },
      },
      []
    )
  ).toBe(true);
});

it('merges artifacts and distinguishes missing work from unnecessary work', () => {
  const path = temp();
  for (const [directory, id, status] of [
    ['web', 'test:web', 'passed'],
    ['windows', 'test:core', 'failed'],
  ]) {
    mkdirSync(join(path, directory));
    writeFileSync(
      join(path, directory, 'results.json'),
      JSON.stringify([{ id, status, durationMs: 1200 }])
    );
  }
  const results = readResults(path);
  const report = summary(['test:web', 'test:core', 'translations'], results);
  expect(report).toContain('| Tests: Web | `npm run check:test:web` | passed | 1.2s |');
  expect(report).toContain('| Tests: Rust core | `npm run check:test:core` | failed | 1.2s |');
  expect(report).toContain(
    '| Validity: Translation files | `npm run check:translations` | not run |'
  );
  expect(report).toContain('| Build: Main UI | `npm run check:build:ui` | not needed |');
  expect(summary(null, [])).toContain('selection unavailable');
});

it('rejects duplicate or invalid results', () => {
  const result = { id: 'test:web', status: 'passed', durationMs: 0 };
  expect(() => checkResult(result.id, [result, result])).toThrow('Duplicate');
  expect(() => checkResult(result.id, [{ ...result, status: 'skipped' }])).toThrow('Invalid');
  expect(() => checkResult(result.id, [{ ...result, durationMs: -1 }])).toThrow('Invalid');
});

it('records failures and continues to subsequent commands', () => {
  const path = join(temp(), 'results.json');
  vi.stubEnv('CHECK_RESULTS_PATH', path);
  const original = checks['test:web'].command;
  try {
    checks['test:web'].command = [process.execPath, '-e', 'process.exit(7)'];
    expect(() => runChecks(['test:web', 'test:web'])).toThrow('Failed checks');
    const results = JSON.parse(readFileSync(path, 'utf8'));
    expect(results).toHaveLength(2);
    expect(
      results.every(
        (result: { status: string; durationMs: number }) =>
          result.status === 'failed' && result.durationMs >= 0
      )
    ).toBe(true);
  } finally {
    checks['test:web'].command = original;
  }
});

it('fails the report command for missing results even when all jobs claim success', () => {
  const path = temp();
  const reportPath = join(path, 'summary.md');
  const result = spawnSync(process.execPath, [resolve('scripts/report-checks.mjs')], {
    cwd: path,
    env: {
      ...process.env,
      CHECK_ID: '',
      SELECTED_CHECKS: '["test:web"]',
      JOB_RESULTS: JSON.stringify({
        select: { result: 'success' },
        portable: { result: 'success' },
        'native-execution': { result: 'skipped' },
        'native-results': { result: 'skipped' },
      }),
      GITHUB_STEP_SUMMARY: reportPath,
    },
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(readFileSync(reportPath, 'utf8')).toContain(
    '| Tests: Web | `npm run check:test:web` | not run |'
  );
});

it.each(['passed', 'failed', 'missing'])('publishes the actual native result: %s', (status) => {
  const path = temp();
  mkdirSync(join(path, '.check-results'));
  writeFileSync(
    join(path, '.check-results/results.json'),
    JSON.stringify(status === 'missing' ? [] : [{ id: 'test:core', status, durationMs: 10 }])
  );
  const result = spawnSync(process.execPath, [resolve('scripts/report-checks.mjs')], {
    cwd: path,
    env: { ...process.env, CHECK_ID: 'test:core', GITHUB_STEP_SUMMARY: '' },
    encoding: 'utf8',
  });
  expect(result.status).toBe(status === 'passed' ? 0 : 1);
  expect(result.stdout).toContain(`Tests: Rust core: ${status === 'missing' ? 'not run' : status}`);
});

it('emits complete job matrices when all checks are selected', () => {
  const output = join(temp(), 'outputs');
  const result = spawnSync(process.execPath, [resolve('scripts/select-checks.mjs')], {
    env: { ...process.env, GITHUB_EVENT_PATH: '', GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), JSON.parse(line.slice(separator + 1))];
      })
  );
  expect(outputs.selected).toEqual(Object.keys(checks));
  expect(outputs.portable).toHaveLength(7);
  expect(outputs.native).toHaveLength(26);
  for (const check of [...outputs.portable, ...outputs.native]) {
    expect(check.name).toBe(checkName(check.id));
    expect(check.key).toBe(check.id.replaceAll(':', '-'));
  }
});

it('labels retained results from an earlier attempt', () => {
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
  const results = [{ id: 'test:web', status: 'passed', durationMs: 10, attempt: 1 }];
  expect(summary(['test:web'], results)).toContain('| passed (attempt 1) |');
  expect(summary(['test:web'], [{ ...results[0], attempt: 2 }])).toContain('| passed |');
  expect(() => checkResult('test:web', [{ ...results[0], attempt: -1 }])).toThrow('Invalid');
});

it('uploads an empty replacement after setup fails without erasing completed results', () => {
  const workflow = readFileSync('.github/workflows/checks.yml', 'utf8');
  const commands = [...workflow.matchAll(/node -e "([^"]+)"/g)].map((match) => match[1]);
  expect(commands).toHaveLength(2);
  for (const command of commands) {
    const path = temp();
    const report = join(path, '.check-results/results.json');
    expect(spawnSync(process.execPath, ['-e', command], { cwd: path }).status).toBe(0);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toEqual([]);
    const results = [{ id: 'test:web', status: 'passed', durationMs: 10, attempt: 2 }];
    writeFileSync(report, JSON.stringify(results));
    expect(spawnSync(process.execPath, ['-e', command], { cwd: path }).status).toBe(0);
    expect(JSON.parse(readFileSync(report, 'utf8'))).toEqual(results);
  }
});
