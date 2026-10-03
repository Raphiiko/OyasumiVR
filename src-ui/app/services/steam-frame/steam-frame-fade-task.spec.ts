import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SteamFrameBrightness,
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFrameFadeError,
  SteamFrameFadeOutcome,
} from '../../models/steam-frame';
import { SteamFrameFadeTask } from './steam-frame-fade-task';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type FadeArgs = { pairingId: string; request: { operation: string; durationMs: number } };

function setup(durationMs = 60_000) {
  const replies: ((error: SteamFrameFadeError | null) => void)[] = [];
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== 'steam_frame_fade') return undefined;
    return new Promise((resolve, reject) =>
      replies.push((error) => (error ? reject(error) : resolve(undefined)))
    );
  });
  const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({});
  const fadeEnded = new Subject<SteamFrameFadeEnded>();
  const onAccept = vi.fn();
  const task = new SteamFrameFadeTask(
    { pairingId: 'p', control: 'brightness', target: 30, durationMs },
    { connections$: connections, fadeEnded$: fadeEnded },
    onAccept
  );
  const state = (
    status: SteamFrameConnectionState['status'],
    { fade = true, report = true } = {}
  ) =>
    connections.next({
      p: {
        pairingId: 'p',
        status,
        brightness:
          status === 'connected' && report
            ? ({
                percentage: 50,
                fade: fade
                  ? { operation: task.operation, target: 30, remainingMs: 1, endsAt: 0 }
                  : null,
              } as SteamFrameBrightness)
            : null,
      } as SteamFrameConnectionState,
    });
  const end = (outcome: SteamFrameFadeOutcome, operation = task.operation) =>
    fadeEnded.next({ pairingId: 'p', control: 'brightness', operation, outcome });
  const reply = async (error: SteamFrameFadeError | null = null) => {
    while (!replies.length) await wait(1);
    replies.shift()!(error);
    await wait(0);
  };
  const fades = () =>
    vi
      .mocked(invoke)
      .mock.calls.filter(([name]) => name === 'steam_frame_fade')
      .map(([, args]) => (args as FadeArgs).request);
  const cancels = () =>
    vi.mocked(invoke).mock.calls.filter(([name]) => name === 'steam_frame_cancel_fade');
  const statuses: string[] = [];
  task.onCancelled.subscribe(() => statuses.push('cancelled'));
  task.onComplete.subscribe(() => statuses.push('completed'));
  state('connected');
  return { task, state, end, reply, fades, cancels, onAccept, statuses };
}

describe('SteamFrameFadeTask', () => {
  beforeEach(() => vi.useRealTimers());

  it('sends one fade and completes on outcome completed', async () => {
    const h = setup();
    const done = h.task.start();
    await h.reply();
    expect(h.fades()).toEqual([
      { control: 'brightness', target: 30, durationMs: 60_000, operation: h.task.operation },
    ]);
    expect(h.onAccept).toHaveBeenCalledOnce();
    h.end('completed', 'another-operation');
    await wait(0);
    expect(h.statuses).toEqual([]);
    h.end('completed');
    await done;
    expect(h.statuses).toEqual(['completed']);
    expect(h.task.end).toBe('completed');
  });

  it.each(['superseded', 'cancelled', 'externalChange', 'standby', 'runtimeUnavailable'] as const)(
    'is cancelled on outcome %s',
    async (outcome) => {
      const h = setup();
      const done = h.task.start();
      await h.reply();
      h.end(outcome);
      await done;
      expect(h.statuses[0]).toBe('cancelled');
      expect(h.task.end).toBe(outcome);
      expect(h.cancels()).toEqual([]);
    }
  );

  it('keeps an outcome that arrives before the reply', async () => {
    const h = setup(0);
    const done = h.task.start();
    await wait(0);
    h.end('completed');
    await h.reply();
    await done;
    expect(h.task.end).toBe('completed');
  });

  it('completes at its end time while the connection is down', async () => {
    const h = setup(80);
    const done = h.task.start();
    await h.reply();
    h.state('offline');
    await wait(30);
    expect(h.statuses).toEqual([]);
    await done;
    expect(h.statuses).toEqual(['completed']);
  });

  it('keeps running after a reconnect that still reports it', async () => {
    const h = setup();
    const done = h.task.start();
    await h.reply();
    h.state('offline');
    h.state('connected');
    await wait(5);
    expect(h.statuses).toEqual([]);
    h.end('completed');
    await done;
  });

  it('ends as missed after a reconnect that no longer reports it', async () => {
    const h = setup();
    const done = h.task.start();
    await h.reply();
    h.state('offline');
    h.state('connected', { fade: false });
    await done;
    expect(h.task.end).toBe('missed');
    expect(h.statuses[0]).toBe('cancelled');
  });

  it('treats a connected state without a report as down, as during a helper update', async () => {
    const h = setup(80);
    const done = h.task.start();
    await h.reply();
    h.state('connected', { report: false });
    await done;
    expect(h.statuses).toEqual(['completed']);
  });

  it('ends as missed when the restarted helper reports without it', async () => {
    const h = setup();
    const done = h.task.start();
    await h.reply();
    h.state('connected', { report: false });
    h.state('connected', { fade: false });
    await done;
    expect(h.task.end).toBe('missed');
  });

  it('cancels the fade on the helper when cancelled from outside', async () => {
    const h = setup();
    const done = h.task.start();
    await h.reply();
    h.task.cancel();
    await done;
    expect(h.cancels()).toEqual([
      ['steam_frame_cancel_fade', { pairingId: 'p', operation: h.task.operation }],
    ]);
    expect(h.task.end).toBeNull();
  });

  it('fails when the helper refuses it', async () => {
    const h = setup();
    const failed = expect(h.task.start()).rejects.toBe('runtimeUnavailable');
    await h.reply('runtimeUnavailable');
    await failed;
    expect(h.task.isError()).toBe(true);
  });
});
