import { describe, expect, it } from 'vitest';
import { ProtectedSecret } from './secrets';
import { fakeTauri } from '../../testing/fake-tauri';

function secret() {
  return new ProtectedSecret('[Test] The secret');
}

describe('ProtectedSecret', () => {
  it('protects a value that was not stored before', async () => {
    const subject = secret();
    expect(await subject.load(null)).toBeNull();
    const stored = await subject.store('hunter2');
    expect(fakeTauri.isProtected(stored)).toBe(true);
    expect(fakeTauri.unprotect(stored!)).toBe('hunter2');
    expect(fakeTauri.protectCalls).toBe(1);
  });

  it('returns the plain value it unlocks', async () => {
    const stored = fakeTauri.protect('hunter2');
    expect(await secret().load(stored)).toBe('hunter2');
  });

  it('keeps a value it cannot unlock', async () => {
    const subject = secret();
    expect(await subject.load('not-a-blob')).toBeNull();
    expect(await subject.store(null)).toBe('not-a-blob');
    expect(fakeTauri.logsMatching('could not be unlocked')).toHaveLength(1);
  });

  it('does not protect an unchanged value again', async () => {
    const subject = secret();
    const first = await subject.store('hunter2');
    const second = await subject.store('hunter2');
    expect(second).toBe(first);
    expect(fakeTauri.protectCalls).toBe(1);
  });

  it('protects a changed value', async () => {
    const subject = secret();
    const first = await subject.store('hunter2');
    const second = await subject.store('hunter3');
    expect(second).not.toBe(first);
    expect(fakeTauri.unprotect(second!)).toBe('hunter3');
  });

  it('stores nothing when protecting fails, and retries the next time', async () => {
    const subject = secret();
    await subject.store('hunter2');
    fakeTauri.failProtect = true;
    expect(await subject.store('hunter3')).toBeNull();
    expect(fakeTauri.logsMatching('could not be protected')).toHaveLength(1);
    fakeTauri.failProtect = false;
    expect(fakeTauri.unprotect((await subject.store('hunter3'))!)).toBe('hunter3');
  });

  it('replaces a value it could not unlock with a new one', async () => {
    const subject = secret();
    await subject.load('not-a-blob');
    const stored = await subject.store('hunter3');
    expect(fakeTauri.unprotect(stored!)).toBe('hunter3');
    expect(await subject.store(null)).toBeNull();
  });

  it('forgets a value it could not unlock when it is cleared', async () => {
    const subject = secret();
    await subject.load('not-a-blob');
    subject.clear();
    expect(await subject.store(null)).toBeNull();
  });
});
