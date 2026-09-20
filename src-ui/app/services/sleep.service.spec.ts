import { BehaviorSubject, NEVER, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SleepService } from './sleep.service';
import type { OpenVRService } from './openvr.service';
import type { OVRDevice, OVRDevicePose } from '../models/ovr-device';
import type { SleepingPose } from '../models/sleeping-pose';
import { SETTINGS_STORE } from '../globals';
import { AudioDeviceAutomationsService } from './audio-device-automations.service';
import { OscGeneralAutomationsService } from './osc-automations/osc-general-automations.service';
import { OscService } from './osc.service';
import { OSC_SCRIPT_VERSION } from '../models/osc-script';

vi.mock('@tauri-apps/plugin-log', () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('../globals', () => ({
  SETTINGS_KEY_SLEEP_MODE: 'sleepMode',
  SETTINGS_STORE: { set: vi.fn().mockResolvedValue(undefined) },
}));

const hmd: OVRDevice = {
  index: 0,
  class: 'HMD',
  role: 'Invalid',
  battery: 0,
  pose: null,
  isTurningOff: false,
};
const pose: OVRDevicePose = { quaternion: [0, 0, 0, 1], position: [0, 0, 0] };

function setup() {
  const devices = new BehaviorSubject<OVRDevice[]>([hmd]);
  const devicePoses = new BehaviorSubject<Record<number, OVRDevicePose>>({});
  const service = new SleepService(
    { devices, devicePoses } as unknown as OpenVRService,
    undefined!,
    undefined!,
    undefined!,
    undefined!
  );
  const classify = vi
    .spyOn(
      service as unknown as { getSleepingPoseForDevicePose: (p: OVRDevicePose) => SleepingPose },
      'getSleepingPoseForDevicePose'
    )
    .mockReturnValue('SIDE_LEFT');
  return { service, classify, emit: () => devicePoses.next({ 0: pose }) };
}

describe('shared sleeping pose', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('classifies once per update for startup and view subscribers', () => {
    const { service, classify, emit } = setup();
    const consumers = Array.from({ length: 5 }, () => vi.fn());
    const subscriptions = consumers.map((consumer) => service.pose.subscribe(consumer));
    consumers.forEach((consumer) => expect(consumer).toHaveBeenLastCalledWith('UNKNOWN'));
    emit();
    expect(classify).toHaveBeenCalledTimes(1);
    emit();
    vi.advanceTimersByTime(1000);
    expect(classify).toHaveBeenCalledTimes(2);
    consumers.forEach((consumer) =>
      expect(consumer.mock.calls).toEqual([['UNKNOWN'], ['SIDE_LEFT']])
    );
    const late = vi.fn();
    const lateSubscription = service.pose.subscribe(late);
    expect(late.mock.calls).toEqual([['SIDE_LEFT']]);
    expect(classify).toHaveBeenCalledTimes(2);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    lateSubscription.unsubscribe();
    emit();
    expect(classify).toHaveBeenCalledTimes(3);
    const reopened = service.pose.subscribe(late);
    expect(late).toHaveBeenLastCalledWith('SIDE_LEFT');
    expect(classify).toHaveBeenCalledTimes(3);
    reopened.unsubscribe();
  });

  it('shares the stability window and broadcasts forced poses', () => {
    const { service, classify, emit } = setup();
    const first = vi.fn();
    const a = service.pose.subscribe(first);
    emit();
    vi.advanceTimersByTime(500);
    const second = vi.fn();
    const b = service.pose.subscribe(second);
    emit();
    vi.advanceTimersByTime(500);
    expect(first).toHaveBeenLastCalledWith('SIDE_LEFT');
    expect(second).toHaveBeenLastCalledWith('SIDE_LEFT');
    service.forcePose('SIDE_BACK');
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    expect(second).toHaveBeenLastCalledWith('SIDE_BACK');
    classify.mockReturnValueOnce('SIDE_LEFT').mockReturnValueOnce('SIDE_RIGHT');
    emit();
    emit();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    emit();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    a.unsubscribe();
    b.unsubscribe();
  });
});

describe('sleep mode change actions', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('waits for audio and queued OSC wake actions while persisting immediately', async () => {
    const devices = new BehaviorSubject<OVRDevice[]>([]);
    const devicePoses = new BehaviorSubject<Record<number, OVRDevicePose>>({});
    const notifications = {
      notificationTypeEnabled: vi.fn().mockResolvedValue(false),
    };
    const service = new SleepService(
      { devices, devicePoses } as unknown as OpenVRService,
      notifications as never,
      { logEvent: vi.fn() } as never,
      undefined!,
      undefined!
    );
    (service as unknown as { _mode: BehaviorSubject<boolean | null> })._mode.next(true);
    const configs = new BehaviorSubject({
      AUDIO_DEVICE_AUTOMATIONS: {
        enabled: true,
        onSleepEnableAutomations: [],
        onSleepDisableAutomations: [
          {
            type: 'MUTE' as const,
            applyOnStart: false,
            audioDeviceRef: {
              persistentId: 'device',
              type: 'Render' as const,
              name: { display: 'Headphones', driver: '' },
            },
          },
        ],
        onSleepPreparationAutomations: [],
      },
      OSC_GENERAL: {
        enabled: true,
        onSleepModeDisable: {
          version: OSC_SCRIPT_VERSION,
          commands: [{ type: 'SLEEP' as const, duration: 100 }],
        },
      },
    });
    let finishAudio!: () => void;
    const setMute = vi.fn(() => new Promise<void>((resolve) => (finishAudio = resolve)));
    const audioAutomations = new AudioDeviceAutomationsService(
      service,
      { onSleepPreparation: new Subject<void>() } as never,
      { configs, updateAutomationConfig: vi.fn() } as never,
      {
        activeDevices: NEVER,
        getAudioDeviceForPersistentId: vi.fn().mockReturnValue({
          id: 'device-id',
          parsedName: { display: 'Headphones', driver: '' },
        }),
        setMute,
      } as never,
      { logEvent: vi.fn() } as never
    );
    const osc = new OscService({ settingsSync: { oscTargets: [] } } as never);
    const oscAutomations = new OscGeneralAutomationsService({ configs } as never, service, osc, {
      onSleepPreparation: new Subject<void>(),
    } as never);
    await audioAutomations.init();
    await oscAutomations.init();

    let settled = false;
    const disabling = service.disableSleepMode({ type: 'MANUAL' }).then(() => (settled = true));
    await Promise.resolve();

    expect(SETTINGS_STORE.set).toHaveBeenCalledWith('sleepMode', false);
    expect(setMute).toHaveBeenCalledWith('device-id', true);
    expect(settled).toBe(false);
    finishAudio();
    await vi.advanceTimersByTimeAsync(99);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await disabling;
    expect(settled).toBe(true);
  });
});
