import test from 'node:test';
import assert from 'node:assert/strict';
import { runMigrations } from './migration-runner.ts';
import type { MigrationDefinition, Versioned } from './migration-runner.ts';

interface Settings extends Versioned {
  name?: string;
  nested?: { items: number[] };
  normalized?: boolean;
}

test('migrates through each step in order', async () => {
  const calls: number[] = [];
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 3,
    steps: {
      0: (data) => {
        calls.push(data.version);
        return { ...data, version: 1, name: 'v1' };
      },
      1: (data) => {
        calls.push(data.version);
        return { ...data, version: 2, name: 'v2' };
      },
      2: (data) => {
        calls.push(data.version);
        return { ...data, version: 3, name: 'v3' };
      },
    },
  };
  const result = await runMigrations({ version: 0, name: 'v0' }, definition);
  if (result.status !== 'migrated') assert.fail(`expected 'migrated', got '${result.status}'`);
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(result.value, { version: 3, name: 'v3' });
});

test('awaits async steps before running the next one', async () => {
  const order: string[] = [];
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 2,
    steps: {
      0: async (data) => {
        order.push('start0');
        await Promise.resolve();
        order.push('end0');
        return { ...data, version: 1 };
      },
      1: (data) => {
        order.push('step1');
        return { ...data, version: 2 };
      },
    },
  };
  const result = await runMigrations({ version: 0 }, definition);
  if (result.status !== 'migrated') assert.fail(`expected 'migrated', got '${result.status}'`);
  assert.deepEqual(order, ['start0', 'end0', 'step1']);
  assert.equal(result.value.version, 2);
});

test('returns unchanged at the target version without running steps', async () => {
  const calls: string[] = [];
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 2,
    steps: {
      0: (data) => {
        calls.push('step0');
        return { ...data, version: 1 };
      },
      1: (data) => {
        calls.push('step1');
        return { ...data, version: 2 };
      },
    },
    normalizeCurrentVersion: (data) => {
      calls.push('normalize');
      return { ...data, normalized: true };
    },
  };
  const input: Settings = { version: 2, name: 'x' };
  const result = await runMigrations(input, definition);
  if (result.status !== 'unchanged') assert.fail(`expected 'unchanged', got '${result.status}'`);
  assert.deepEqual(calls, ['normalize']);
  assert.notEqual(result.value, input);
  assert.deepEqual(result.value, { version: 2, name: 'x', normalized: true });
});

test('reports future when the input version is above the target', async () => {
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 2,
    steps: { 1: (data) => ({ ...data, version: 2 }) },
    normalizeCurrentVersion: (data) => ({ ...data, normalized: true }),
  };
  const input: Settings = { version: 5 };
  const result = await runMigrations(input, definition);
  if (result.status !== 'future') assert.fail(`expected 'future', got '${result.status}'`);
  assert.notEqual(result.value, input);
  assert.deepEqual(result.value, { version: 5 });
});

test('reports unsupported below the minimum supported version', async () => {
  const calls: string[] = [];
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 3,
    minimumSupportedVersion: 2,
    steps: {
      2: (data) => {
        calls.push('step2');
        return { ...data, version: 3 };
      },
    },
    normalizeCurrentVersion: (data) => {
      calls.push('normalize');
      return data;
    },
  };
  const result = await runMigrations({ version: 1 }, definition);
  if (result.status !== 'unsupported')
    assert.fail(`expected 'unsupported', got '${result.status}'`);
  assert.equal(result.minimumSupportedVersion, 2);
  assert.deepEqual(result.value, { version: 1 });
  assert.deepEqual(calls, []);
});

test('runs the chain from exactly the minimum supported version', async () => {
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 3,
    minimumSupportedVersion: 2,
    steps: { 2: (data) => ({ ...data, version: 3, name: 'migrated' }) },
  };
  const result = await runMigrations({ version: 2 }, definition);
  if (result.status !== 'migrated') assert.fail(`expected 'migrated', got '${result.status}'`);
  assert.deepEqual(result.value, { version: 3, name: 'migrated' });
});

test('fails when the input has no integer version', async () => {
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 1,
    steps: { 0: (data) => ({ ...data, version: 1 }) },
  };
  const badInputs: unknown[] = [
    null,
    3,
    {},
    { version: undefined },
    { version: null },
    { version: 1.5 },
    { version: Number.NaN },
    { version: '1' },
  ];
  for (const bad of badInputs) {
    const result = await runMigrations(bad as Settings, definition);
    if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
    assert.equal(result.sourceVersion, null);
    assert.equal(result.targetVersion, 1);
    assert.ok(
      result.cause instanceof Error,
      `cause must be an Error for input ${JSON.stringify(bad)}`
    );
  }
});

test('fails when a step is missing for the next hop', async () => {
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 3,
    steps: { 1: (data) => ({ ...data, version: 2 }) },
  };
  const result = await runMigrations({ version: 1 }, definition);
  if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
  assert.equal(result.sourceVersion, 2);
  assert.equal(result.targetVersion, 3);
  assert.ok(result.cause instanceof Error && /version 2/.test(result.cause.message));
});

test('keeps the original error from a step that throws', async () => {
  const boom = new Error('boom');
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 1,
    steps: {
      0: () => {
        throw boom;
      },
    },
  };
  const result = await runMigrations({ version: 0 }, definition);
  if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
  assert.equal(result.sourceVersion, 0);
  assert.equal(result.targetVersion, 1);
  assert.equal(result.cause, boom);
});

test('keeps the original reason from a step that rejects', async () => {
  const boom = new Error('async boom');
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 1,
    steps: { 0: () => Promise.reject(boom) },
  };
  const result = await runMigrations({ version: 0 }, definition);
  if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
  assert.equal(result.sourceVersion, 0);
  assert.equal(result.targetVersion, 1);
  assert.equal(result.cause, boom);
});

test('fails when a step does not advance exactly one version', async () => {
  const badSteps: MigrationDefinition<Settings>['steps']['0'][] = [
    (data) => ({ ...data }),
    (data) => ({ ...data, version: data.version + 2 }),
    () => undefined as unknown as Settings,
  ];
  for (const badStep of badSteps) {
    const definition: MigrationDefinition<Settings> = {
      targetVersion: 1,
      steps: { 0: badStep },
    };
    const result = await runMigrations({ version: 0 }, definition);
    if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
    assert.equal(result.sourceVersion, 0);
    assert.equal(result.targetVersion, 1);
    assert.ok(result.cause instanceof Error, 'cause must be an Error');
  }
});

test('never mutates the caller input', async () => {
  const input: Settings = { version: 0, name: 'original', nested: { items: [1, 2] } };
  const snapshot = structuredClone(input);
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 2,
    steps: {
      0: (data) => {
        data.nested!.items.push(3);
        data.name = 'changed';
        data.version = 1;
        return data;
      },
      1: (data) => ({ ...data, version: 2 }),
    },
    normalizeCurrentVersion: (data) => ({ ...data, normalized: true }),
  };
  const result = await runMigrations(input, definition);
  assert.deepEqual(input, snapshot);
  if (result.status !== 'migrated') assert.fail(`expected 'migrated', got '${result.status}'`);
  assert.notEqual(result.value, input);
  assert.notEqual(result.value.nested, input.nested);
  assert.deepEqual(result.value.nested, { items: [1, 2, 3] });
  assert.equal(input.name, 'original');
});

test('normalizes only after the chain reaches the target', async () => {
  const order: string[] = [];
  let normalizedVersion = -1;
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 2,
    steps: {
      0: (data) => {
        order.push('step0');
        return { ...data, version: 1 };
      },
      1: async (data) => {
        order.push('step1');
        return { ...data, version: 2 };
      },
    },
    normalizeCurrentVersion: (data) => {
      order.push('normalize');
      normalizedVersion = data.version;
      return { ...data, normalized: true };
    },
  };
  const result = await runMigrations({ version: 0 }, definition);
  if (result.status !== 'migrated') assert.fail(`expected 'migrated', got '${result.status}'`);
  assert.deepEqual(order, ['step0', 'step1', 'normalize']);
  assert.equal(normalizedVersion, 2);
  assert.equal(result.value.normalized, true);
});

test('skips the normalizer when the chain does not succeed', async () => {
  let normalized = 0;
  const counting = (data: Settings): Settings => {
    normalized++;
    return data;
  };
  await runMigrations(
    { version: 3 },
    { targetVersion: 2, steps: {}, normalizeCurrentVersion: counting }
  );
  await runMigrations(
    { version: 0 },
    { targetVersion: 2, minimumSupportedVersion: 1, steps: {}, normalizeCurrentVersion: counting }
  );
  await runMigrations(
    { version: 0 },
    {
      targetVersion: 1,
      steps: {
        0: () => {
          throw new Error('boom');
        },
      },
      normalizeCurrentVersion: counting,
    }
  );
  assert.equal(normalized, 0);
});

test('fails with the original cause when the normalizer throws', async () => {
  const boom = new Error('normalize boom');
  const definition: MigrationDefinition<Settings> = {
    targetVersion: 1,
    steps: { 0: (data) => ({ ...data, version: 1 }) },
    normalizeCurrentVersion: () => {
      throw boom;
    },
  };
  const result = await runMigrations({ version: 0 }, definition);
  if (result.status !== 'failed') assert.fail(`expected 'failed', got '${result.status}'`);
  assert.equal(result.sourceVersion, 1);
  assert.equal(result.targetVersion, 1);
  assert.equal(result.cause, boom);
});
