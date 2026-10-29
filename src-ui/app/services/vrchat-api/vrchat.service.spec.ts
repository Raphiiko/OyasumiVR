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

function makeService() {
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
  const login = (id: string) =>
    service['auth']['userSubject'].next({ id } as unknown as CurrentUser);
  return { service, logEvents, login };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('VRChatService world context', () => {
  it('keeps log events emitted before init', async () => {
    const { service, logEvents } = makeService();

    logEvents.next({
      type: 'OnLocationChange',
      instanceId: 'wrld_a:1',
      timestamp: new Date(1000),
      initialLoad: true,
    });

    expect((await firstValueFrom(service.world)).instanceId).toBe('wrld_a:1');
  });

  it('marks the world loaded when login follows the own join', async () => {
    const { service, logEvents, login } = makeService();
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
    await flush();
    expect((await firstValueFrom(service.world)).loaded).toBe(false);

    login('usr_me');

    const world = await firstValueFrom(service.world);
    expect(world.loaded).toBe(true);
    expect(world.joinedAt).toBe(2000);
  });
});
