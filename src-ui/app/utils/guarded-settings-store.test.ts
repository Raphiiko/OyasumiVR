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
let saveEnd = 0;
let failDeleteKey: string | null = null;

const origSet = LazyStore.prototype.set;
const origDelete = LazyStore.prototype.delete;
const origClear = LazyStore.prototype.clear;
const origSave = LazyStore.prototype.save;

LazyStore.prototype.set = async function (key: string, value: unknown) {
  await new Promise((resolve) => setTimeout(resolve, 10));
  setCalls.push([key, value]);
  setEnd = performance.now();
};
LazyStore.prototype.delete = async function (key: string) {
  deleteCalls.push(key);
  if (key === failDeleteKey) {
    throw new Error('delete failed');
  }
  return true;
};
LazyStore.prototype.clear = async function () {
  clearStart = performance.now();
  clearCalls++;
};
LazyStore.prototype.save = async function () {
  await new Promise((resolve) => setTimeout(resolve, 10));
  saveCalls++;
  saveEnd = performance.now();
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
    saveEnd = 0;
    failDeleteKey = null;
  });

  it('passes set through before any delete or clear', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.set('KEY', { a: 1 });
    assert.deepEqual(setCalls, [['KEY', { a: 1 }]]);
  });

  it('blocks all sets after a delete', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.delete('KEY');
    await store.set('OTHER', 'value');
    assert.equal(setCalls.length, 0);
    assert.deepEqual(deleteCalls, ['KEY']);
  });

  it('blocks all sets after a clear', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.clear();
    await store.set('KEY', 'value');
    assert.equal(setCalls.length, 0);
    assert.equal(clearCalls, 1);
  });

  it('still passes delete and clear through while blocked', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.delete('KEY_A');
    await store.delete('KEY_B');
    assert.deepEqual(deleteCalls, ['KEY_A', 'KEY_B']);
  });

  it('flushes deletion to disk before delete resolves', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.delete('KEY');
    assert.equal(saveCalls, 1);
    assert.ok(saveEnd > 0);
  });

  it('flushes clear to disk before clear resolves', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await store.clear();
    assert.equal(saveCalls, 1);
    assert.ok(saveEnd > clearStart);
  });

  it('waits for every sibling deletion before deleteAll rejects', async () => {
    const store = new GuardedSettingsStore('test.dat');
    failDeleteKey = 'KEY_A';
    await assert.rejects(store.deleteAll(['KEY_A', 'KEY_B']));
    assert.deepEqual(deleteCalls, ['KEY_A', 'KEY_B']);
    assert.equal(saveCalls, 1);
  });

  it('serializes an overlapping set before a clear', async () => {
    const store = new GuardedSettingsStore('test.dat');
    await Promise.all([store.set('KEY', 'stale'), store.clear()]);
    assert.equal(setCalls.length, 1);
    assert.equal(clearCalls, 1);
    assert.ok(setEnd < clearStart);
  });
});
