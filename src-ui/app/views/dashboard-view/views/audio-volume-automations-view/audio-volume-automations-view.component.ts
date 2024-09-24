import { Component, DestroyRef, OnInit } from '@angular/core';
import {
  AudioDeviceAutomationsConfig,
  AudioVolumeAutomation,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../models/automations';

import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-audio-volume-automations-view',
  templateUrl: './audio-volume-automations-view.component.html',
  styleUrls: ['./audio-volume-automations-view.component.scss'],
})
export class AudioVolumeAutomationsViewComponent implements OnInit {
  config: AudioDeviceAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUDIO_DEVICE_AUTOMATIONS
  );

  constructor(
    private automationsConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.automationsConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.AUDIO_DEVICE_AUTOMATIONS)
        // distinctUntilChanged((previous, current) => isEqual(previous, current))
      )
      .subscribe((config) => {
        this.config = config;
      });
  }

  async onAutomationsChange(
    event: 'onSleepEnable' | 'onSleepDisable' | 'onSleepPreparation',
    automations: AudioVolumeAutomation[]
  ) {
    switch (event) {
      case 'onSleepEnable':
        await this.automationsConfigService.updateAutomationConfig<AudioDeviceAutomationsConfig>(
          'AUDIO_DEVICE_AUTOMATIONS',
          {
            onSleepEnableAutomations: automations,
          }
        );
        break;
      case 'onSleepDisable':
        await this.automationsConfigService.updateAutomationConfig<AudioDeviceAutomationsConfig>(
          'AUDIO_DEVICE_AUTOMATIONS',
          {
            onSleepDisableAutomations: automations,
          }
        );
        break;
      case 'onSleepPreparation':
        await this.automationsConfigService.updateAutomationConfig<AudioDeviceAutomationsConfig>(
          'AUDIO_DEVICE_AUTOMATIONS',
          {
            onSleepPreparationAutomations: automations,
          }
        );
        break;
    }
  }
}
