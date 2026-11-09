import '@angular/compiler';
import type { Injector } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelemetryService } from './telemetry.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('../../globals', () => ({
  SETTINGS_KEY_TELEMETRY_SETTINGS: 'TELEMETRY_SETTINGS',
  SETTINGS_STORE: { get: vi.fn(), set: vi.fn() },
}));

const DAY = 24 * 60 * 60_000;

describe('TelemetryService', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps every throttled event in the cache when two overlap', async () => {
    const pending: Array<() => void> = [];
    invoke.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
    const service = new TelemetryService({} as Injector);

    const first = service.trackThrottledEvent('feature_snapshot', { a: 1 }, 1000);
    const second = service.trackThrottledEvent('use_language', { language: 'en' }, 1000);
    pending[0]();
    await first;
    pending[1]();
    await second;

    let events: string[] = [];
    service.settings.subscribe((s) => (events = s.reportingCache.map((e) => e.event)));
    expect(events.sort()).toEqual(['feature_snapshot', 'use_language']);
  });

  it('sends a throttled event once when calls overlap its send', async () => {
    invoke.mockReset();
    const pending: Array<() => void> = [];
    invoke.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
    const service = new TelemetryService({} as Injector);

    const first = service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    const second = service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    pending.forEach((resolve) => resolve());
    await Promise.all([first, second]);

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('retries a failed throttled event only after 10 minutes', async () => {
    vi.useFakeTimers({ now: 0 });
    invoke.mockReset();
    invoke.mockRejectedValue('offline');
    const service = new TelemetryService({} as Injector);

    await service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    vi.setSystemTime(10 * 60_000 - 1);
    await service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    expect(invoke).toHaveBeenCalledTimes(1);

    vi.setSystemTime(10 * 60_000);
    await service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('keeps the full timeout when an older send fails after a newer one with the same value succeeded', async () => {
    vi.useFakeTimers({ now: 0 });
    invoke.mockReset();
    const sends: Array<{ resolve: () => void; reject: (e: unknown) => void }> = [];
    invoke.mockImplementation(
      () => new Promise<void>((resolve, reject) => sends.push({ resolve, reject }))
    );
    const service = new TelemetryService({} as Injector);

    const olderA = service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    const b = service.trackThrottledEvent('vr_hmd', { hmdName: 'B' }, DAY, true);
    const newerA = service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    sends[1].resolve();
    sends[2].resolve();
    await Promise.all([b, newerA]);
    sends[0].reject('offline');
    await olderA;

    vi.setSystemTime(10 * 60_000);
    void service.trackThrottledEvent('vr_hmd', { hmdName: 'A' }, DAY, true);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it('enables telemetry in the core before init resolves', async () => {
    vi.useFakeTimers();
    invoke.mockReset();
    const injector = { get: () => ({ init: () => undefined }) } as unknown as Injector;
    const service = new TelemetryService(injector);

    await service.init();

    expect(invoke).toHaveBeenCalledWith('set_telemetry_enabled', { enable: true });
  });
});
