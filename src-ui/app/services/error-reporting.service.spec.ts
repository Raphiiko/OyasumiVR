import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviorSubject } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';
import * as Sentry from '@sentry/angular';
import { ErrorReportingService } from './error-reporting.service';
import type { TelemetryService } from './telemetry.service';
import type { StoreSnapshotService } from './store-snapshot.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@sentry/angular', () => ({
  init: vi.fn(),
  close: vi.fn(async () => true),
  captureException: vi.fn(),
}));
vi.mock('../../build', () => ({ FLAVOUR: 'STEAM' }));
vi.mock('../../environments/environment', () => ({ environment: { production: true } }));
vi.mock('../utils/app-utils', () => ({ getVersion: vi.fn(async () => 'test') }));

describe('initialization error consent', () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(contents: string | null) {
    const settings = new BehaviorSubject({ enabled: false });
    const readLiveStore = vi.fn(async () => ({ exists: true, contents }));
    const service = new ErrorReportingService(
      { settings } as unknown as TelemetryService,
      { readLiveStore } as unknown as StoreSnapshotService
    );
    return { service, readLiveStore };
  }

  it('reports a migration failure with explicit saved consent without starting analytics', async () => {
    const { service } = setup('{"TELEMETRY_SETTINGS":{"version":1,"enabled":true}}');
    const failure = new Error('Settings migration failed');
    await service.captureInitializationException(failure);
    expect(invoke).toHaveBeenCalledWith('set_error_reporting_enabled', { enabled: true });
    expect(Sentry.captureException).toHaveBeenCalledWith(failure);
    expect(invoke).not.toHaveBeenCalledWith('set_telemetry_enabled', expect.anything());
  });

  it.each([
    null,
    '{',
    '{}',
    '{"TELEMETRY_SETTINGS":{"enabled":false}}',
    '{"TELEMETRY_SETTINGS":{"enabled":"true"}}',
  ])('does not report without readable explicit consent: %s', async (contents) => {
    const { service } = setup(contents);
    await service.captureInitializationException(new Error('Migration failed'));
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('set_error_reporting_enabled', { enabled: true });
  });

  it('honors the current opt-out without rereading older saved consent', async () => {
    const { service, readLiveStore } = setup('{"TELEMETRY_SETTINGS":{"enabled":true}}');
    await service.init();
    await service.captureInitializationException(new Error('Later initialization failed'));
    expect(readLiveStore).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('set_error_reporting_enabled', { enabled: false });
  });

  it('does not replace the startup failure when reading settings fails', async () => {
    const { service, readLiveStore } = setup(null);
    readLiveStore.mockRejectedValue(new Error('Access denied'));
    await expect(
      service.captureInitializationException(new Error('Migration failed'))
    ).resolves.toBeUndefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
