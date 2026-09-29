import '@angular/compiler';
import { signal } from '@angular/core';
import type { DestroyRef } from '@angular/core';
import type { HttpClient } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../../../../services/app-settings.service';
import type { UpdateService } from '../../../../services/update.service';
import { SettingsUpdatesViewComponent } from './settings-updates-view.component';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

type View = {
  FLAVOUR: string;
  updateAvailable: { checked: boolean; update?: { version: string } };
  updateState: string;
  updateOrCheck(): Promise<void>;
};

describe('SettingsUpdatesViewComponent update state', () => {
  let view: View;
  const installing = signal(false);

  beforeEach(() => {
    vi.useFakeTimers();
    installing.set(false);
    const update = {
      installing,
      // publishes a found update right away, as a fast check would
      checkForUpdate: vi.fn(async () => {
        view.updateAvailable = { checked: true, update: { version: '26.10.0' } };
      }),
    } as unknown as UpdateService;
    view = new SettingsUpdatesViewComponent(
      update,
      {} as HttpClient,
      {} as DestroyRef,
      {} as AppSettingsService
    ) as unknown as View;
    view.FLAVOUR = 'STANDALONE';
  });

  afterEach(() => vi.useRealTimers());

  it('keeps checking for the minimum time when a check finds an update', async () => {
    const check = view.updateOrCheck();
    await vi.advanceTimersByTimeAsync(50);
    expect(view.updateAvailable.update).toBeDefined();
    expect(view.updateState).toBe('checking');

    await vi.advanceTimersByTimeAsync(1000);
    await check;
    expect(view.updateState).toBe('available');
  });

  it('shows installing over every other standalone state', async () => {
    view.updateAvailable = { checked: true, update: { version: '26.10.0' } };
    installing.set(true);
    expect(view.updateState).toBe('installing');
  });
});
