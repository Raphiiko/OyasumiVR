import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DMKnownDevice } from '../../../models/device-manager';
import { SteamFramePairing } from '../../../models/steam-frame';
import { DeviceManagerService } from '../../device-manager.service';
import { SteamFramePairingService } from '../../steam-frame-pairing.service';
import { MessageCenterService, MessageItem } from '../message-center.service';
import { SteamFramePairingMessageMonitor } from './steam-frame-pairing-message-monitor';

vi.mock('../../device-manager.service', () => ({ DeviceManagerService: class {} }));
vi.mock('../../steam-frame-pairing.service', () => ({ SteamFramePairingService: class {} }));
vi.mock('../message-center.service', () => ({ MessageCenterService: class {} }));

const hmd = (serial: string, typeName: string): DMKnownDevice => ({
  id: `OVR_HMD_${serial}`,
  typeName,
  manufacturer: 'Valve',
  defaultName: serial,
  deviceType: 'HMD',
  lastSeen: 0,
  tagIds: [],
  disabled: false,
});

function start() {
  const frame = hmd('FPTEST000001', 'Deckard DV2');
  const index = hmd('LHR-TEST', 'Index');
  const known = new BehaviorSubject([frame, index]);
  const observed = new BehaviorSubject([frame.id, index.id]);
  const pairings$ = new BehaviorSubject<SteamFramePairing[]>([]);
  const messages = new Map<string, MessageItem>();
  const openWizard = vi.fn();
  const framePairing = {
    pairings$,
    identityOf: (d: DMKnownDevice) => (d.typeName === 'Deckard DV2' ? {} : null),
    pairingFor: (id: string) => pairings$.value.find((p) => p.deviceId === id),
    openWizard,
  };
  const messageCenter = {
    addMessage: (m: MessageItem) => messages.set(m.id, m),
    removeMessage: (id: string) => messages.delete(id),
  } as unknown as MessageCenterService;
  const injector = Injector.create({
    providers: [
      {
        provide: DeviceManagerService,
        useValue: { knownDevices: known, observedDevices: observed },
      },
      { provide: SteamFramePairingService, useValue: framePairing },
    ],
  });
  const monitor = runInInjectionContext(
    injector,
    () => new SteamFramePairingMessageMonitor(messageCenter)
  );
  monitor.init();
  return { frame, observed, pairings$, messages, openWizard };
}

describe('Steam Frame pairing invitation', () => {
  it('invites a connected, unpaired Frame under an id of its own, which hiding persists', () => {
    const h = start();
    expect([...h.messages.keys()]).toEqual(['framePairable-OVR_HMD_FPTEST000001']);
    const message = h.messages.get('framePairable-OVR_HMD_FPTEST000001')!;
    expect(message).toMatchObject({ title: 'steamFrame.invitation.title', hideable: true });
    message.actions[0].action();
    expect(h.openWizard).toHaveBeenCalledWith(h.frame);
  });

  it('withdraws the invitation once paired or disconnected', () => {
    const h = start();
    h.pairings$.next([{ deviceId: h.frame.id, complete: true } as SteamFramePairing]);
    expect(h.messages.size).toBe(0);
    h.pairings$.next([]);
    expect(h.messages.size).toBe(1);
    h.observed.next([]);
    expect(h.messages.size).toBe(0);
  });
});
