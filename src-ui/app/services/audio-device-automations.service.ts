import { Injectable } from '@angular/core';
import { AudioDeviceService } from './audio-device.service';
import { AutomationConfigService } from './automation-config.service';
import {
  AudioDeviceAutomationsConfig,
  AudioVolumeAutomation,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../models/automations';
import { isEqual } from 'lodash';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { delay, distinctUntilChanged, firstValueFrom, map, of, skip, switchMap, take } from 'rxjs';
import { AudioDeviceParsedName } from '../models/audio-device';
import { info } from '@tauri-apps/plugin-log';
import { EventLogService } from './event-log.service';
import { EventLogFailure } from '../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class AudioDeviceAutomationsService {
  private config: AudioDeviceAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUDIO_DEVICE_AUTOMATIONS
  );

  constructor(
    private sleepService: SleepService,
    private sleepPreparationService: SleepPreparationService,
    private automationConfigService: AutomationConfigService,
    private audioDeviceService: AudioDeviceService,
    private eventLog: EventLogService
  ) {}

  async init() {
    // Keep track of config changes
    this.automationConfigService.configs.subscribe((configs) => {
      this.config = configs.AUDIO_DEVICE_AUTOMATIONS;
    });
    // Run automations on OyasumiVR start
    of(null)
      .pipe(
        delay(2000),
        switchMap(() => this.sleepService.mode.pipe(take(1))),
        map(
          (sleepMode) =>
            [
              sleepMode
                ? this.config.onSleepEnableAutomations
                : this.config.onSleepDisableAutomations,
              sleepMode,
            ] as [AudioVolumeAutomation[], boolean]
        ),
        map(
          ([automations, sleepMode]) =>
            [automations.filter((a) => a.applyOnStart), sleepMode] as [
              AudioVolumeAutomation[],
              boolean,
            ]
        )
      )
      .subscribe(([automations, sleepMode]) => {
        for (const automation of automations) {
          this.runAutomation(automation, sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED');
        }
      });
    // Run automations on sleep mode change
    this.sleepService.mode.pipe(skip(1), distinctUntilChanged()).subscribe(async (sleepMode) => {
      const automations = sleepMode
        ? this.config.onSleepEnableAutomations
        : this.config.onSleepDisableAutomations;
      for (const automation of automations) {
        await this.runAutomation(
          automation,
          sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED'
        );
      }
    });
    // Run automations on sleep preparation
    this.sleepPreparationService.onSleepPreparation.subscribe(async () => {
      for (const automation of this.config.onSleepPreparationAutomations) {
        await this.runAutomation(automation, 'SLEEP_PREPARATION');
      }
    });
    // Update automations for default devices when the default devices change
    this.audioDeviceService.activeDevices
      .pipe(
        map((devices) => {
          const defaultCaptureId = devices.find(
            (d) => d.default && d.deviceType === 'Capture'
          )?.persistentId;
          const defaultPlaybackId = devices.find(
            (d) => d.default && d.deviceType === 'Render'
          )?.persistentId;
          return { defaultCaptureId, defaultPlaybackId };
        }),
        distinctUntilChanged((previous, current) => isEqual(previous, current))
      )
      .subscribe(async () => {
        const config = structuredClone(
          (await firstValueFrom(this.automationConfigService.configs)).AUDIO_DEVICE_AUTOMATIONS
        );
        const automations = [
          ...config.onSleepEnableAutomations,
          ...config.onSleepDisableAutomations,
          ...config.onSleepPreparationAutomations,
        ];
        let automationModified = false;
        for (const automation of automations) {
          if (
            automation.audioDeviceRef.persistentId === 'DEFAULT_CAPTURE' ||
            automation.audioDeviceRef.persistentId === 'DEFAULT_RENDER'
          ) {
            const currentDeviceName = automation.audioDeviceRef.name;
            const supposedDeviceName: AudioDeviceParsedName | null =
              this.audioDeviceService.getAudioDeviceNameForPersistentId(
                automation.audioDeviceRef.persistentId
              );
            if (supposedDeviceName === null) continue;
            if (!isEqual(supposedDeviceName, currentDeviceName)) {
              automation.audioDeviceRef.name = supposedDeviceName;
              automationModified = true;
            }
          }
        }
        if (automationModified) {
          await this.automationConfigService.updateAutomationConfig<AudioDeviceAutomationsConfig>(
            'AUDIO_DEVICE_AUTOMATIONS',
            config
          );
        }
      });
  }

  private async runAutomation(
    automation: AudioVolumeAutomation,
    reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION'
  ) {
    const device = this.audioDeviceService.getAudioDeviceForPersistentId(
      automation.audioDeviceRef.persistentId
    );

    // apply the change
    let applied = false;
    if (device) {
      applied =
        automation.type === 'SET_VOLUME'
          ? await this.audioDeviceService.setVolume(device.id, automation.volume / 100)
          : !!(await this.audioDeviceService.setMute(device.id, automation.type === 'MUTE'));
    }
    let failure: EventLogFailure | undefined;
    if (!device) failure = 'DEVICE_NOT_FOUND';
    else if (!applied) failure = 'UNKNOWN';
    info(
      `[AudioDeviceAutomations] ${failure ? `Could not apply (${failure})` : 'Applied'} ${automation.type} to ${automation.audioDeviceRef.type.toLowerCase()} device '${automation.audioDeviceRef.name.display}' (Reason: ${reason})`
    );

    // log the result
    const common = {
      deviceName: automation.audioDeviceRef.name,
      deviceType: automation.audioDeviceRef.type,
      reason,
      failure,
    };
    switch (automation.type) {
      case 'SET_VOLUME':
        this.eventLog.logEvent({
          type: 'changedAudioDeviceVolume',
          volume: automation.volume,
          ...common,
        });
        break;
      case 'MUTE':
        this.eventLog.logEvent({ type: 'mutedAudioDevice', ...common });
        break;
      case 'UNMUTE':
        this.eventLog.logEvent({ type: 'unmutedAudioDevice', ...common });
        break;
    }
  }
}
