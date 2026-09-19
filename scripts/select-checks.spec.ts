import { afterEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { comparisonBase } from './select-checks.mjs';

vi.mock('node:child_process', async (original) => ({
  ...(await original<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('compares the entire PR against its merge base', async () => {
  vi.stubEnv('GITHUB_EVENT_NAME', 'pull_request');
  vi.mocked(execFileSync).mockReturnValue('common\n');
  expect(
    await comparisonBase({ pull_request: { base: { sha: 'base' }, head: { sha: 'head' } } })
  ).toBe('common');
  expect(execFileSync).toHaveBeenCalledWith(
    'git',
    ['merge-base', 'base', 'head'],
    expect.anything()
  );
});

it('uses a successful ancestor, excluding the current run and unrelated history', async () => {
  vi.stubEnv('GITHUB_EVENT_NAME', 'push');
  vi.stubEnv('GITHUB_RUN_ID', '3');
  vi.stubEnv('GITHUB_SHA', 'head');
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      workflow_runs: [
        { id: 3, head_sha: 'head' },
        { id: 2, head_sha: 'unrelated' },
        { id: 1, head_sha: 'verified' },
      ],
    }),
  });
  vi.stubGlobal('fetch', fetch);
  vi.mocked(execFileSync).mockImplementation((_file, args) => {
    if (args?.includes('unrelated')) throw new Error('not an ancestor');
    return '';
  });
  expect(await comparisonBase({})).toBe('verified');
  expect(String(fetch.mock.calls[0][0])).toContain('status=success');
  expect(execFileSync).toHaveBeenCalledTimes(2);
});

it('requires a full run without a successful baseline or on manual dispatch', async () => {
  vi.stubEnv('GITHUB_EVENT_NAME', 'push');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflow_runs: [] }) })
  );
  expect(await comparisonBase({})).toBeNull();
  vi.stubEnv('GITHUB_EVENT_NAME', 'workflow_dispatch');
  expect(await comparisonBase({})).toBeNull();
});

it('fails selection closed when the API is unavailable', async () => {
  vi.stubEnv('GITHUB_EVENT_NAME', 'push');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
  await expect(comparisonBase({})).rejects.toThrow('HTTP 403');
});
