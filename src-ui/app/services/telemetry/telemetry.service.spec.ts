import '@angular/compiler';
import type { Injector } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { TelemetryService } from './telemetry.service';

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock('@aptabase/tauri', () => ({ trackEvent }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../globals', () => ({
  SETTINGS_KEY_TELEMETRY_SETTINGS: 'TELEMETRY_SETTINGS',
  SETTINGS_STORE: { get: vi.fn(), set: vi.fn() },
}));

describe('TelemetryService', () => {
  it('keeps every throttled event in the cache when two overlap', async () => {
    const pending: Array<() => void> = [];
    trackEvent.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
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
});
