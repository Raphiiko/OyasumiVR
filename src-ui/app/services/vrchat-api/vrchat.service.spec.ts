import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from 'vrchat';
import type { VRChatLogEvent } from '../../models/vrchat-log-event';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }));

import { ModalService } from '../modal.service';
import { ErrorReportingService } from '../telemetry/error-reporting.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { VRChatLogService } from '../vrchat-log.service';
import { VRChatService } from './vrchat.service';

async function makeService() {
  const logEvents = new Subject<VRChatLogEvent>();
  const logService = { logEvents, initialLoadComplete: new BehaviorSubject(true) };
  const injector = Injector.create({
    providers: [
      { provide: ModalService, useValue: {} },
      { provide: VRChatLogService, useValue: logService },
      { provide: ErrorReportingService, useValue: { captureException: vi.fn() } },
      { provide: TelemetryService, useValue: { trackThrottledEvent: vi.fn() } },
    ],
  });
  const service = runInInjectionContext(injector, () => new VRChatService());
  vi.spyOn(service as never, 'loadSettings').mockResolvedValue(undefined as never);
  vi.spyOn(service['api'], 'init').mockResolvedValue();
  vi.spyOn(service['auth'], 'init').mockResolvedValue();
  vi.spyOn(service['socket'], 'init').mockReturnValue();
  await service.init();
  const login = (id: string) =>
    service['auth']['userSubject'].next({ id } as unknown as CurrentUser);
  return { service, logEvents, login };
}

describe('VRChatService world context', () => {
  it('marks the world loaded when login follows the own join', async () => {
    const { service, logEvents, login } = await makeService();
    logEvents.next({
      type: 'OnLocationChange',
      instanceId: 'wrld_a:1',
      timestamp: new Date(1000),
      initialLoad: true,
    });
    logEvents.next({
      type: 'OnPlayerJoined',
      displayName: 'Me',
      userId: 'usr_me',
      timestamp: new Date(2000),
      initialLoad: true,
    });
    expect((await firstValueFrom(service.world)).loaded).toBe(false);

    login('usr_me');

    const world = await firstValueFrom(service.world);
    expect(world.loaded).toBe(true);
    expect(world.joinedAt).toBe(2000);
  });

  it('marks the world loaded when login lands right after the own join', async () => {
    const { service, logEvents, login } = await makeService();
    logEvents.next({
      type: 'OnPlayerJoined',
      displayName: 'Me',
      userId: 'usr_me',
      timestamp: new Date(2000),
      initialLoad: true,
    });
    login('usr_me');

    const world = await firstValueFrom(service.world);
    expect(world.loaded).toBe(true);
    expect(world.joinedAt).toBe(2000);
  });
});
