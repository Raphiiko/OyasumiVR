import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import type { EventLog } from '../models/event-log-entry.ts';
import { EventLogStoreWriter } from './event-log-store-writer.ts';

describe('EventLogStoreWriter', () => {
  it('serializes an older save after a clear', async () => {
    const calls: string[] = [];
    const defaultLog: EventLog = { logs: [], version: 5 };
    let storeValue: EventLog | undefined;
    let savedValue: EventLog | undefined;
    const staleLog: EventLog = { logs: [], version: 5 };
    const writer = new EventLogStoreWriter({
      async set(_key, value) {
        await new Promise((resolve) => setTimeout(resolve, value === staleLog ? 30 : 0));
        calls.push('set');
        storeValue = value;
      },
      async save() {
        calls.push('save');
        savedValue = storeValue;
      },
    });

    const staleSave = writer.save(staleLog);
    const clear = writer.clear(defaultLog);
    await Promise.all([staleSave, clear]);

    assert.deepEqual(calls, ['set', 'set', 'save']);
    assert.equal(savedValue?.logs.length, 0);
  });
});
