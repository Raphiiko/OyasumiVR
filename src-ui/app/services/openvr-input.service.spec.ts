import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { OpenVRInputService } from './openvr-input.service';
import type { OpenVRService, OpenVRStatus } from './openvr.service';
import { OVRInputEventAction, type OVRInputEvent } from '../models/ovr-input-event';
import type { OVRDevice } from '../models/ovr-device';
import { OverlayService } from './overlay/overlay.service';
import { SystemMicMuteAutomationService } from './system-mic-mute-automation.service';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));

const controller: OVRDevice = {
  index: 1,
  class: 'Controller',
  role: 'LeftHand',
  battery: 80,
  pose: null,
  isTurningOff: false,
};

async function createInput(initial: OpenVRStatus = 'INITIALIZED') {
  const status = new BehaviorSubject<OpenVRStatus>(initial);
  const input = new OpenVRInputService({ status } as unknown as OpenVRService);
  await input.init();
  const callback = vi
    .mocked(listen)
    .mock.calls.find(
      ([name]) => name === 'OVR_INPUT_EVENT_DIGITAL'
    )![1] as EventCallback<OVRInputEvent>;
  const emit = (
    action: OVRInputEventAction,
    pressed = true,
    device: OVRDevice | null = controller
  ) =>
    callback({
      event: 'OVR_INPUT_EVENT_DIGITAL',
      id: 1,
      payload: { action, pressed, device, timeAgo: 0 },
    });
  return { input, status, emit };
}

describe('OpenVR input session reset', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['INACTIVE', 'INITIALIZING'] as const)(
    'clears all held actions on %s and accepts reused indices',
    async (nextStatus) => {
      const { input, status, emit } = await createInput();
      const updates = vi.fn();
      input.state.subscribe(updates);
      for (const action of Object.values(OVRInputEventAction)) emit(action);
      expect(
        Object.values(await firstValueFrom(input.state)).every((devices) => devices.length === 1)
      ).toBe(true);

      status.next(nextStatus);
      expect(
        Object.values(await firstValueFrom(input.state)).every((devices) => devices.length === 0)
      ).toBe(true);
      const resetCount = updates.mock.calls.length;
      status.next(nextStatus);
      for (const action of Object.values(OVRInputEventAction)) emit(action);
      expect(updates).toHaveBeenCalledTimes(resetCount);

      status.next('INITIALIZED');
      for (const action of Object.values(OVRInputEventAction)) emit(action);
      expect(
        Object.values(await firstValueFrom(input.state)).every((devices) => devices[0]?.index === 1)
      ).toBe(true);
      for (const action of Object.values(OVRInputEventAction)) emit(action, false);
      expect(
        Object.values(await firstValueFrom(input.state)).every((devices) => devices.length === 0)
      ).toBe(true);
    }
  );

  it.each(['INACTIVE', 'INITIALIZING', 'INITIALIZED'] as const)(
    'ignores null-device events while %s',
    async (initial) => {
      const { input, emit } = await createInput(initial);
      const updates = vi.fn();
      input.state.subscribe(updates);
      for (const action of Object.values(OVRInputEventAction)) {
        emit(action, true, null);
        emit(action, false, null);
      }
      expect(updates).toHaveBeenCalledOnce();
    }
  );

  it('does not toggle the overlay on reset, but the first new-session press does', async () => {
    const { input, status, emit } = await createInput();
    const client = { toggleOverlayMenu: vi.fn() };
    const settings = new BehaviorSubject({
      ...APP_SETTINGS_DEFAULT,
      overlayMenuEnabled: true,
      overlayMenuOnlyOpenWhenVRChatIsRunning: false,
    });
    const overlay = new OverlayService(
      {
        overlaySidecarClient: new BehaviorSubject(client),
        getOverlaySidecarClient: () => client,
      } as unknown as ConstructorParameters<typeof OverlayService>[0],
      input,
      { settings } as unknown as ConstructorParameters<typeof OverlayService>[2],
      { vrchatProcessActive: new BehaviorSubject(false) } as unknown as ConstructorParameters<
        typeof OverlayService
      >[3]
    );
    await overlay.init();
    emit(OVRInputEventAction.OpenOverlay);
    expect(client.toggleOverlayMenu).toHaveBeenCalledOnce();
    status.next('INACTIVE');
    expect(client.toggleOverlayMenu).toHaveBeenCalledOnce();
    status.next('INITIALIZED');
    emit(OVRInputEventAction.OpenOverlay);
    expect(client.toggleOverlayMenu).toHaveBeenCalledTimes(2);
  });

  it.each(['TOGGLE', 'PUSH_TO_TALK'] as const)(
    'delivers release and new-session press to %s microphone bindings',
    async (behavior) => {
      const { input, status, emit } = await createInput();
      const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
      Object.assign(configs.SYSTEM_MIC_MUTE_AUTOMATIONS, {
        controllerBinding: true,
        controllerBindingBehavior: behavior,
      });
      const mic = new SystemMicMuteAutomationService(
        { configs: new BehaviorSubject(configs) } as unknown as ConstructorParameters<
          typeof SystemMicMuteAutomationService
        >[0],
        {
          activeDevices: new BehaviorSubject([]),
          getAudioDeviceForPersistentId: () => ({ mute: true }),
        } as unknown as ConstructorParameters<typeof SystemMicMuteAutomationService>[1],
        input,
        {} as ConstructorParameters<typeof SystemMicMuteAutomationService>[3],
        {} as ConstructorParameters<typeof SystemMicMuteAutomationService>[4],
        { playSound: vi.fn(async () => {}) } as unknown as ConstructorParameters<
          typeof SystemMicMuteAutomationService
        >[5],
        {} as ConstructorParameters<typeof SystemMicMuteAutomationService>[6],
        {} as ConstructorParameters<typeof SystemMicMuteAutomationService>[7]
      );
      mic['config'] = configs.SYSTEM_MIC_MUTE_AUTOMATIONS;
      const setMute = vi.spyOn(mic, 'setMute').mockResolvedValue(null);
      mic['handleControllerBinding']();
      await Promise.resolve();
      setMute.mockClear();

      emit(OVRInputEventAction.MuteMicrophone);
      await vi.waitFor(() => expect(setMute).toHaveBeenCalledWith(false));
      setMute.mockClear();
      status.next('INACTIVE');
      await Promise.resolve();
      await Promise.resolve();
      expect(setMute.mock.calls).toEqual(behavior === 'PUSH_TO_TALK' ? [[true]] : []);
      setMute.mockClear();
      status.next('INITIALIZED');
      emit(OVRInputEventAction.MuteMicrophone);
      await vi.waitFor(() => expect(setMute).toHaveBeenCalledWith(false));
    }
  );
});
