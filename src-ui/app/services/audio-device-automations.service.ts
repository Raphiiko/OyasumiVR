import { Injectable } from '@angular/core';
import { AudioDeviceService } from './audio-device.service';
import { AutomationConfigService } from './automation-config.service';
import {
  AudioDeviceAutomationsConfig,
  AudioVolumeAutomation,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../models/automations';
import { cloneDeep, isEqual } from 'lodash';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { distinctUntilChanged, firstValueFrom, map, skip } from 'rxjs';
import { AudioDeviceParsedName } from '../models/audio-device';
import { info } from 'tauri-plugin-log-api';
import { EventLogService } from './event-log.service';
import {
  EventLogChangedAudioDeviceVolume,
  EventLogMutedAudioDevice,
  EventLogUnmutedAudioDevice,
} from '../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class AudioDeviceAutomationsService {
  private config: AudioDeviceAutomationsConfig = cloneDeep(
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
    // Run automations on sleep mode change
    this.sleepService.mode.pipe(skip(1), distinctUntilChanged()).subscribe(async (sleepMode) => {
      let automations = sleepMode
        ? this.config.onSleepEnableAutomations
        : this.config.onSleepDisableAutomations;
      for (let automation of automations) {
        await this.runAutomation(
          automation,
          sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED'
        );
      }
    });
    // Run automations on sleep preparation
    this.sleepPreparationService.onSleepPreparation.subscribe(async () => {
      for (let automation of this.config.onSleepPreparationAutomations) {
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
      .subscribe(async (devices) => {
        const config = cloneDeep(
          (await firstValueFrom(this.automationConfigService.configs)).AUDIO_DEVICE_AUTOMATIONS
        );
        const automations = [
          ...config.onSleepEnableAutomations,
          ...config.onSleepDisableAutomations,
          ...config.onSleepPreparationAutomations,
        ];
        let automationModified = false;
        for (let automation of automations) {
          if (
            automation.audioDeviceRef.persistentId === 'DEFAULT_CAPTURE' ||
            automation.audioDeviceRef.persistentId === 'DEFAULT_RENDER'
          ) {
            let currentDeviceName = automation.audioDeviceRef.name;
            let supposedDeviceName: AudioDeviceParsedName | null =
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
    if (device) {
      let deviceName = device.parsedName!.driver
        ? `${device.parsedName?.display} (${device.parsedName?.driver})`
        : device.parsedName!.display;
      switch (automation.type) {
        case 'SET_VOLUME':
          await this.audioDeviceService.setVolume(device.id, automation.volume / 100);
          info(
            `[AudioDeviceAutomations] Set volume of ${automation.audioDeviceRef.type.toLowerCase()} device '${deviceName}' to ${
              automation.volume
            }% (Reason: ${reason})`
          );
          this.eventLog.logEvent({
            type: 'changedAudioDeviceVolume',
            volume: automation.volume,
            deviceName: automation.audioDeviceRef.name,
            deviceType: automation.audioDeviceRef.type,
            reason,
          } as EventLogChangedAudioDeviceVolume);
          break;
        case 'MUTE':
          await this.audioDeviceService.setMute(device.id, true);
          info(
            `[AudioDeviceAutomations] Muted ${automation.audioDeviceRef.type.toLowerCase()} device '${deviceName}' (Reason: ${reason})`
          );
          this.eventLog.logEvent({
            type: 'mutedAudioDevice',
            deviceName: automation.audioDeviceRef.name,
            deviceType: automation.audioDeviceRef.type,
            reason,
          } as EventLogMutedAudioDevice);
          break;
        case 'UNMUTE':
          await this.audioDeviceService.setMute(device.id, false);
          info(
            `[AudioDeviceAutomations] Unmuted ${automation.audioDeviceRef.type.toLowerCase()} device '${deviceName}' (Reason: ${reason})`
          );
          this.eventLog.logEvent({
            type: 'unmutedAudioDevice',
            deviceName: automation.audioDeviceRef.name,
            deviceType: automation.audioDeviceRef.type,
            reason,
          } as EventLogUnmutedAudioDevice);
          break;
      }
    }
  }
}
