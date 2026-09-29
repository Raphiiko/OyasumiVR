import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { MigrationDefinition, Versioned } from './migration-runner.ts';
import { applyStoreMigration, decideStoreMigration } from './store-migration.ts';

const migration = (
  targetVersion: number,
  steps: Record<number, (data: Versioned & Record<string, unknown>) => Versioned> = {}
): MigrationDefinition<Versioned> => ({
  targetVersion,
  minimumSupportedVersion: 1,
  steps,
});

const spec = (
  definition: MigrationDefinition<Versioned> = migration(2, {
    1: (data) => ({ ...data, version: 2 }),
  })
) => ({
  storeName: 'settings',
  migrations: { CONFIG: definition },
  defaults: { CONFIG: { version: definition.targetVersion, value: 'default' } },
});

const candidate = (id: string, kind: 'live' | 'snapshot' | 'checkpoint', value: unknown) => ({
  id,
  kind,
  contents: typeof value === 'string' ? value : JSON.stringify(value),
});

test('keeps a current live store unchanged', async () => {
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: { version: 2, value: 'live' } })],
    spec()
  );
  assert.equal(decision.action, 'keep-live');
});

test('keep-live performs no filesystem or UI action', async () => {
  const migrationSpec = spec();
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: { version: 2 } })],
    migrationSpec
  );
  let calls = 0;
  const called = async () => {
    calls++;
  };
  await applyStoreMigration(
    decision,
    { exists: true, parsesAsObject: true, contents: '{}', parsed: {} },
    migrationSpec,
    {
      createCheckpoint: called,
      quarantineStore: called,
      replaceStore: called,
      notifyFallback: called,
    }
  );
  assert.equal(calls, 0);
});

test('checkpoints and installs a forward migration as one store value', async () => {
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: { version: 1, value: 'live' }, KEEP: 7 })],
    spec()
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.checkpointLive, true);
  assert.equal(decision.checkpointReason, 'schema-migration');
  assert.deepEqual(JSON.parse(decision.contents), {
    CONFIG: { version: 2, value: 'live' },
    KEEP: 7,
  });
});

test('uses a rolling snapshot after a corrupt live candidate', async () => {
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', '{'),
      candidate('snapshot', 'snapshot', { CONFIG: { version: 2, value: 'snapshot' } }),
    ],
    spec()
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'snapshot');
  assert.equal(decision.checkpointLive, false);
  assert.equal(decision.quarantineLive, true);
});

test('checkpoints future live bytes before restoring a compatible checkpoint', async () => {
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', { CONFIG: { version: 3, value: 'beta' } }),
      candidate('release', 'checkpoint', { CONFIG: { version: 2, value: 'release' } }),
    ],
    spec()
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'release');
  assert.equal(decision.checkpointLive, true);
  assert.equal(decision.checkpointReason, 'store-recovery');
});

test('skips a broken newest checkpoint for an older compatible checkpoint', async () => {
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', { CONFIG: { version: 3 } }),
      { id: 'newest', kind: 'checkpoint' as const, contents: null },
      candidate('older', 'checkpoint', { CONFIG: { version: 2, value: 'older' } }),
    ],
    spec()
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'older');
});

test('tries the next candidate after a migration throws', async () => {
  const throwing = spec(
    migration(2, {
      1: () => {
        throw new Error('broken migration');
      },
    })
  );
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', { CONFIG: { version: 1 } }),
      candidate('checkpoint', 'checkpoint', { CONFIG: { version: 2, value: 'safe' } }),
    ],
    throwing
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'checkpoint');
});

test('tries the next candidate after normalization throws', async () => {
  const definition = migration(1);
  definition.normalizeCurrentVersion = (data) => {
    if ((data as Record<string, unknown>)['bad']) throw new Error('broken normalization');
    return data;
  };
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', { CONFIG: { version: 1, bad: true } }),
      candidate('checkpoint', 'checkpoint', { CONFIG: { version: 1, value: 'safe' } }),
    ],
    spec(definition)
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'checkpoint');
});

test('treats a non-versioned known key as an unviable candidate', async () => {
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: null })],
    spec()
  );
  assert.equal(decision.action, 'install-defaults');
});

test('prefers newer migratable live data over an older current checkpoint', async () => {
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', { CONFIG: { version: 1, value: 'newer' } }),
      candidate('checkpoint', 'checkpoint', { CONFIG: { version: 2, value: 'older' } }),
    ],
    spec()
  );
  assert.equal(decision.action, 'install');
  if (decision.action !== 'install') return;
  assert.equal(decision.selectedId, 'live');
  assert.equal(JSON.parse(decision.contents).CONFIG.value, 'newer');
});

test('falls back atomically and preserves unversioned live keys when all candidates fail', async () => {
  const migrationSpec = spec();
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: { version: 9 }, KEEP: { enabled: true } })],
    migrationSpec
  );
  assert.equal(decision.action, 'install-defaults');
  if (decision.action !== 'install-defaults') return;
  assert.deepEqual(JSON.parse(decision.contents), {
    KEEP: { enabled: true },
    CONFIG: { version: 2, value: 'default' },
  });

  const calls: string[] = [];
  await applyStoreMigration(
    decision,
    { exists: true, parsesAsObject: true, contents: '{}', parsed: {} },
    migrationSpec,
    {
      createCheckpoint: async () => void calls.push('checkpoint'),
      quarantineStore: async () => void calls.push('quarantine'),
      replaceStore: async () => void calls.push('replace'),
      notifyFallback: async () => void calls.push('notify'),
    }
  );
  assert.deepEqual(calls, ['checkpoint', 'quarantine', 'replace', 'notify']);
});

test('recovers each key independently when no whole-store candidate is viable', async () => {
  const migrationSpec = {
    storeName: 'settings',
    migrations: {
      FIRST: migration(2, { 1: (data) => ({ ...data, version: 2 }) }),
      SECOND: migration(2, { 1: (data) => ({ ...data, version: 2 }) }),
    },
    defaults: {
      FIRST: { version: 2, value: 'first default' },
      SECOND: { version: 2, value: 'second default' },
    },
  };
  const decision = await decideStoreMigration(
    [
      candidate('live', 'live', {
        FIRST: { version: 3, value: 'future' },
        SECOND: { version: 2, value: 'live' },
      }),
      candidate('checkpoint', 'checkpoint', {
        FIRST: { version: 2, value: 'checkpoint' },
        SECOND: { version: 3, value: 'future' },
      }),
    ],
    migrationSpec
  );
  assert.equal(decision.action, 'install-defaults');
  if (decision.action !== 'install-defaults') return;
  assert.deepEqual(JSON.parse(decision.contents), {
    FIRST: { version: 2, value: 'checkpoint' },
    SECOND: { version: 2, value: 'live' },
  });
});

test('leaves an unreadable live store untouched when no backup is viable', async () => {
  const decision = await decideStoreMigration(
    [
      { id: 'live', kind: 'live', contents: null },
      { id: 'snapshot', kind: 'snapshot', contents: null },
    ],
    spec()
  );
  assert.equal(decision.action, 'defer');
  let calls = 0;
  const called = async () => {
    calls++;
  };
  await applyStoreMigration(
    decision,
    { exists: true, parsesAsObject: false, contents: null, parsed: null },
    spec(),
    {
      createCheckpoint: called,
      quarantineStore: called,
      replaceStore: called,
      notifyFallback: called,
    }
  );
  assert.equal(calls, 0);
});

test('blocks replacement when quarantine fails', async () => {
  const migrationSpec = spec();
  const decision = await decideStoreMigration(
    [candidate('live', 'live', { CONFIG: { version: 9 } })],
    migrationSpec
  );
  let replaced = false;
  await assert.rejects(() =>
    applyStoreMigration(
      decision,
      { exists: true, parsesAsObject: true, contents: '{}', parsed: {} },
      migrationSpec,
      {
        createCheckpoint: async () => undefined,
        quarantineStore: async () => {
          throw new Error('locked');
        },
        replaceStore: async () => {
          replaced = true;
        },
        notifyFallback: async () => undefined,
      }
    )
  );
  assert.equal(replaced, false);
});

test('does not expose a partially migrated multi-key candidate', async () => {
  const original = {
    FIRST: { version: 1, value: 'one' },
    SECOND: { version: 1, value: 'two' },
  };
  const migrationSpec = {
    storeName: 'settings',
    migrations: {
      FIRST: migration(2, { 1: (data) => ({ ...data, version: 2 }) }),
      SECOND: migration(2, {
        1: () => {
          throw new Error('second failed');
        },
      }),
    },
    defaults: {
      FIRST: { version: 2, value: 'first default' },
      SECOND: { version: 2, value: 'second default' },
    },
  };
  const decision = await decideStoreMigration([candidate('live', 'live', original)], migrationSpec);
  assert.equal(decision.action, 'install-defaults');
  assert.deepEqual(original, {
    FIRST: { version: 1, value: 'one' },
    SECOND: { version: 1, value: 'two' },
  });
});

test('bootstraps a fresh install without a fallback notice', async () => {
  const migrationSpec = spec();
  const decision = await decideStoreMigration([], migrationSpec);
  assert.equal(decision.action, 'install-defaults');
  if (decision.action !== 'install-defaults') return;
  assert.equal(decision.hadCandidates, false);
  let notified = false;
  await applyStoreMigration(
    decision,
    { exists: false, parsesAsObject: false, contents: null, parsed: null },
    migrationSpec,
    {
      createCheckpoint: async () => undefined,
      quarantineStore: async () => undefined,
      replaceStore: async () => undefined,
      notifyFallback: async () => {
        notified = true;
      },
    }
  );
  assert.equal(notified, false);
});

test('restores the most recent compatible state across an A/B/A/B channel round trip', async () => {
  const releaseA = spec(migration(1));
  const betaB = spec(
    migration(2, {
      1: (data) => ({ ...data, version: 2 }),
    })
  );
  const stateA = { CONFIG: { version: 1, channel: 'release' } };
  const firstBeta = await decideStoreMigration([candidate('live', 'live', stateA)], betaB);
  assert.equal(firstBeta.action, 'install');
  if (firstBeta.action !== 'install') return;
  const stateB = JSON.parse(firstBeta.contents);
  stateB.CONFIG.channel = 'beta-updated';

  const backToA = await decideStoreMigration(
    [candidate('live', 'live', stateB), candidate('checkpoint-a', 'checkpoint', stateA)],
    releaseA
  );
  assert.equal(backToA.action, 'install');
  if (backToA.action !== 'install') return;
  assert.equal(backToA.selectedId, 'checkpoint-a');
  const updatedRelease = JSON.parse(backToA.contents);
  updatedRelease.CONFIG.channel = 'release-updated';

  const backToB = await decideStoreMigration(
    [
      candidate('live', 'live', updatedRelease),
      candidate('snapshot', 'snapshot', stateB),
      candidate('checkpoint-b', 'checkpoint', stateB),
      candidate('checkpoint-a', 'checkpoint', stateA),
    ],
    betaB
  );
  assert.equal(backToB.action, 'install');
  if (backToB.action !== 'install') return;
  assert.equal(backToB.selectedId, 'live');
  assert.equal(JSON.parse(backToB.contents).CONFIG.channel, 'release-updated');
});
