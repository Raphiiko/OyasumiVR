import { BehaviorSubject, NEVER, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioDeviceAutomationsConfig } from '../models/automations';
import { AwaitableEventSource } from '../utils/awaitable-event';
import { AudioDeviceAutomationsService } from './audio-device-automations.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

const config: AudioDeviceAutomationsConfig = {
  enabled: true,
  onSleepEnableAutomations: [],
  onSleepDisableAutomations: [
    {
      type: 'MUTE',
      applyOnStart: false,
      audioDeviceRef: {
        persistentId: 'device',
        type: 'Render',
        name: { display: 'Headphones', driver: '' },
      },
    },
    {
      type: 'UNMUTE',
      applyOnStart: false,
      audioDeviceRef: {
        persistentId: 'device',
        type: 'Render',
        name: { display: 'Headphones', driver: '' },
      },
    },
  ],
  onSleepPreparationAutomations: [],
};

describe('AudioDeviceAutomationsService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('runs once per wake action and waits for automations in order', async () => {
    const actions = new AwaitableEventSource<{ mode: boolean; reason: never }>();
    const configs = new BehaviorSubject({ AUDIO_DEVICE_AUTOMATIONS: config });
    let finishFirst!: () => void;
    const setMute = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (finishFirst = resolve)))
      .mockResolvedValueOnce(undefined);
    const service = new AudioDeviceAutomationsService(
      { onSleepModeChangeActions: actions.event, mode: NEVER } as never,
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

    await service.init();
    expect(setMute).not.toHaveBeenCalled();

    let settled = false;
    const emission = actions.emit({ mode: false, reason: undefined as never }).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(setMute).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finishFirst();
    await emission;
    expect(setMute.mock.calls).toEqual([
      ['device-id', true],
      ['device-id', false],
    ]);
    expect(settled).toBe(true);
  });
});
