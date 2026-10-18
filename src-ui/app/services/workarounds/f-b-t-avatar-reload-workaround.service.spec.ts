import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationConfigService } from '../automation-config.service';
import type { OpenVRService } from '../openvr.service';
import type { OscService } from '../osc.service';
import type { SleepingAnimationsAutomationService } from '../osc-automations/sleeping-animations-automation.service';
import type { VRChatService } from '../vrchat-api/vrchat.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type { OVRDevice } from '../../models/ovr-device';
import { FBTAvatarReloadWorkaroundService } from './f-b-t-avatar-reload-workaround.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

function tracker(index: number, state: Partial<OVRDevice> = {}): OVRDevice {
  return {
    index,
    serialNumber: `T${index}`,
    class: 'GenericTracker',
    canPowerOff: true,
    isConnected: true,
    isTurningOff: false,
    ...state,
  } as OVRDevice;
}

async function setup() {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  configs.SLEEPING_ANIMATIONS.enableAvatarReloadOnFBTDisableWorkaround = true;
  const devices = new BehaviorSubject<OVRDevice[]>([]);
  const powerControlled = new Set<string>();
  const emit = (list: OVRDevice[]) => {
    list.filter((d) => d.canPowerOff).forEach((d) => powerControlled.add(d.serialNumber!));
    devices.next(list);
  };
  const service = new FBTAvatarReloadWorkaroundService(
    {
      devices,
      hasHadPowerControl: (d: OVRDevice) => powerControlled.has(d.serialNumber!),
    } as unknown as OpenVRService,
    {} as OscService,
    { vrchatProcessActive: of(true) } as unknown as VRChatService,
    {} as SleepingAnimationsAutomationService,
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService
  );
  const triggerHotfix = vi
    .spyOn(service as never, 'triggerHotfix' as never)
    .mockImplementation((() => Promise.resolve()) as never);
  await service.init();
  return { emit, triggerHotfix };
}

describe('FBTAvatarReloadWorkaroundService', () => {
  it('reloads the avatar when all trackers turn off', async () => {
    const h = await setup();
    h.emit([tracker(1), tracker(2)]);
    h.emit([tracker(1, { canPowerOff: false, isConnected: false }), tracker(2)]);
    h.emit([
      tracker(1, { canPowerOff: false, isConnected: false }),
      tracker(2, { canPowerOff: false, isConnected: false }),
    ]);
    expect(h.triggerHotfix).toHaveBeenCalledTimes(1);
  });

  it('ignores trackers that stay connected but cannot be turned off', async () => {
    const h = await setup();
    h.emit([tracker(1), tracker(2)]);
    h.emit([tracker(1, { canPowerOff: false }), tracker(2, { canPowerOff: false })]);
    expect(h.triggerHotfix).not.toHaveBeenCalled();
  });
});
