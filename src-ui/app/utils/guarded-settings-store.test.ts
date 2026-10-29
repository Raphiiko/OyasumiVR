import { afterAll, beforeEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { LazyStore } from '@tauri-apps/plugin-store';
import { GuardedSettingsStore } from './guarded-settings-store.ts';

let setCalls: Array<[string, unknown]> = [];
let deleteCalls: string[] = [];
let clearCalls = 0;
let saveCalls = 0;
let setEnd = 0;
let clearStart = 0;
let failDeleteKey: string | null = null;
let setCompletion = Promise.resolve();
let setStarted = Promise.withResolvers<void>();
let deleteCompletion = Promise.resolve();
let deleteCompletions = new Map<string, Promise<void>>();
let deleteStarted = new Map<string, PromiseWithResolvers<void>>();
let deleteFinished = new Map<string, PromiseWithResolvers<void>>();
let saveCompletion = Promise.resolve();
let saveStarted = Promise.withResolvers<void>();
let nextOperationStamp = 0;

const origSet = LazyStore.prototype.set;
const origDelete = LazyStore.prototype.delete;
const origClear = LazyStore.prototype.clear;
const origSave = LazyStore.prototype.save;

LazyStore.prototype.set = async function (key: string, value: unknown) {
  setCalls.push([key, value]);
  setStarted.resolve();
  await setCompletion;
  setEnd = ++nextOperationStamp;
};
LazyStore.prototype.delete = async function (key: string) {
  deleteStarted.get(key)?.resolve();
  const keyedCompletion = deleteCompletions.get(key);
  if (keyedCompletion) await keyedCompletion;
  await deleteCompletion;
  deleteCalls.push(key);
  deleteFinished.get(key)?.resolve();
  if (key === failDeleteKey) {
    throw new Error('delete failed');
  }
  return true;
};
LazyStore.prototype.clear = async function () {
  clearStart = ++nextOperationStamp;
  clearCalls++;
};
LazyStore.prototype.save = async function () {
  saveCalls++;
  saveStarted.resolve();
  await saveCompletion;
};

afterAll(() => {
  LazyStore.prototype.set = origSet;
  LazyStore.prototype.delete = origDelete;
  LazyStore.prototype.clear = origClear;
  LazyStore.prototype.save = origSave;
});

describe('GuardedSettingsStore', () => {
  beforeEach(() => {
    setCalls = [];
    deleteCalls = [];
    clearCalls = 0;
    saveCalls = 0;
    setEnd = 0;
    clearStart = 0;
    failDeleteKey = null;
    setCompletion = Promise.resolve();
    setStarted = Promise.withResolvers<void>();
    deleteCompletion = Promise.resolve();
    deleteCompletions = new Map();
    deleteStarted = new Map();
    deleteFinished = new Map();
    saveCompletion = Promise.resolve();
    saveStarted = Promise.withResolvers<void>();
    nextOperationStamp = 0;
  });

  it('blocks all sets after a delete', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.delete('KEY');
    await store.set('OTHER', 'value');
    assert.equal(setCalls.length, 0);
    assert.deepEqual(deleteCalls, ['KEY']);
    assert.equal(saveCalls, 1);
  });

  it('blocks all sets after a clear', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.clear();
    await store.set('KEY', 'value');
    assert.equal(setCalls.length, 0);
    assert.equal(clearCalls, 1);
    assert.equal(saveCalls, 1);
  });

  it('still passes delete and clear through while blocked', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.delete('KEY_A');
    await store.delete('KEY_B');
    await store.clear();
    assert.deepEqual(deleteCalls, ['KEY_A', 'KEY_B']);
    assert.equal(clearCalls, 1);
  });

  it('flushes deletion to disk before delete resolves', async () => {
    const store = new GuardedSettingsStore('test.dat');
    let finishSave!: () => void;
    saveCompletion = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    let deleteSettled = false;
    const deletion = store.delete('KEY');
    void deletion.then(() => {
      deleteSettled = true;
    });
    await saveStarted.promise;
    assert.deepEqual(deleteCalls, ['KEY']);
    assert.equal(saveCalls, 1);
    assert.equal(deleteSettled, false);
    finishSave();
    await deletion;
    assert.equal(deleteSettled, true);
  });

  it('flushes clear to disk before clear resolves', async () => {
    const store = new GuardedSettingsStore('test.dat');
    let finishSave!: () => void;
    saveCompletion = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    let clearSettled = false;
    const clear = store.clear();
    void clear.then(() => {
      clearSettled = true;
    });
    await saveStarted.promise;
    assert.equal(clearCalls, 1);
    assert.equal(saveCalls, 1);
    assert.equal(clearSettled, false);
    finishSave();
    await clear;
    assert.equal(clearSettled, true);
  });

  it('waits for every sibling deletion before deleteAll rejects', async () => {
    const store = new GuardedSettingsStore('test.dat');
    failDeleteKey = 'KEY_A';
    let finishDeleteA!: () => void;
    let finishDeleteB!: () => void;
    const startedA = Promise.withResolvers<void>();
    const startedB = Promise.withResolvers<void>();
    const finishedA = Promise.withResolvers<void>();
    deleteStarted.set('KEY_A', startedA);
    deleteStarted.set('KEY_B', startedB);
    deleteFinished.set('KEY_A', finishedA);
    deleteCompletions.set(
      'KEY_A',
      new Promise<void>((resolve) => {
        finishDeleteA = resolve;
      })
    );
    deleteCompletions.set(
      'KEY_B',
      new Promise<void>((resolve) => {
        finishDeleteB = resolve;
      })
    );
    let deleteAllSettled = false;
    const deleteAll = store.deleteAll(['KEY_A', 'KEY_B']);
    void deleteAll.then(
      () => {
        deleteAllSettled = true;
      },
      () => {
        deleteAllSettled = true;
      }
    );
    await Promise.all([startedA.promise, startedB.promise]);
    assert.equal(saveCalls, 0);
    finishDeleteA();
    await finishedA.promise;
    assert.deepEqual(deleteCalls, ['KEY_A']);
    assert.equal(saveCalls, 0);
    assert.equal(deleteAllSettled, false);
    finishDeleteB();
    await assert.rejects(deleteAll);
    assert.deepEqual(deleteCalls, ['KEY_A', 'KEY_B']);
    assert.equal(saveCalls, 1);
  });

  it('serializes an overlapping set before a clear', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.set('KEY', { a: 1 });
    assert.deepEqual(setCalls, [['KEY', { a: 1 }]]);
    setCalls = [];
    let finishSet!: () => void;
    setCompletion = new Promise<void>((resolve) => {
      finishSet = resolve;
    });
    setStarted = Promise.withResolvers<void>();

    const operations = Promise.all([store.set('KEY', 'stale'), store.clear()]);
    await setStarted.promise;
    assert.equal(clearCalls, 0);
    finishSet();
    await operations;
    assert.deepEqual(setCalls, [['KEY', 'stale']]);
    assert.equal(clearCalls, 1);
    assert.ok(setEnd < clearStart);
  });
});
