import { Component, OnInit } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from '../../../../../../models/automations';
import { SleepDetectionTabComponent } from '../sleep-detection-tab.component';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounce } from 'typescript-debounce-decorator';

import { SleepDetectorCalibrationModalComponent } from '../../modals/sleep-detector-calibration-modal/sleep-detector-calibration-modal.component';
import { filter } from 'rxjs';
import { fade, vshrink } from '../../../../../../utils/animations';

@Component({
  selector: 'app-sleep-detection-detection-tab',
  templateUrl: './sleep-detection-detection-tab.component.html',
  styleUrls: ['./sleep-detection-detection-tab.component.scss'],
  animations: [fade(), vshrink()],
  standalone: false,
})
export class SleepDetectionDetectionTabComponent
  extends SleepDetectionTabComponent
  implements OnInit
{
  protected sensitivityOptions: SelectBoxItem[] = [
    {
      id: 'LOWEST',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.LOWEST',
    },
    {
      id: 'LOW',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.LOW',
    },
    {
      id: 'MEDIUM',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.MEDIUM',
    },
    {
      id: 'HIGH',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.HIGH',
    },
    {
      id: 'HIGHEST',
      label: 'sleep-detection.modals.enableForSleepDetector.sensitivity.presets.HIGHEST',
    },
  ];
  protected sensitivityOption: SelectBoxItem | undefined;
  protected activationWindowStart = '00:00';
  protected activationWindowEnd = '00:00';

  constructor(private router: Router) {
    super();
  }

  ngOnInit() {
    super.ngOnInit();
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.sensitivityOption = this.sensitivityOptions.find(
          (o) => o.id === configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity
        );
        if (!this.sensitivityOption) this.setSensitivityOption('MEDIUM');
        this.activationWindowStart =
          configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart
            .map((v) => v.toString().padStart(2, '0'))
            .join(':');
        this.activationWindowEnd = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
      });
  }

  get showSleepDetectionCalibrationWarning(): boolean {
    return (
      this.automationConfigs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled &&
      this.automationConfigs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue ===
        AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue
    );
  }

  async setSensitivityOption(id: string | undefined) {
    this.sensitivityOption = this.sensitivityOptions.find((o) => o.id === id);
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        sensitivity:
          (this.sensitivityOption?.id as 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST') ??
          'MEDIUM',
      }
    );
  }

  async toggleSleepCheck() {
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        sleepCheck: !this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sleepCheck,
      }
    );
  }

  async toggleControllerPresence() {
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        considerControllerPresence:
          !this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.considerControllerPresence,
      }
    );
  }

  async toggleSleepingPose() {
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        considerSleepingPose:
          !this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.considerSleepingPose,
      }
    );
  }

  @debounce(250)
  async onDetectionWindowChange(value: number) {
    if (value < 15 || value > 60) return;
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        detectionWindowMinutes: value,
      }
    );
  }

  async onChangeActivationWindowStart(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        activationWindowStart: parsedValue,
      }
    );
  }

  async onChangeActivationWindowEnd(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      {
        activationWindowEnd: parsedValue,
      }
    );
  }

  async toggleActivationWindow() {
    // Toggle the activation window
    const config: Partial<SleepModeEnableForSleepDetectorAutomationConfig> = {
      activationWindow:
        !this.automationConfigs?.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR?.activationWindow,
    };
    // Reset the window back to default when turning off the activation window
    if (!config.activationWindow) {
      config.activationWindowStart = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart
      );
      config.activationWindowEnd = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd
      );
    }
    // Apply & Save
    await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
      'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
      config
    );
  }

  calibrate() {
    this.modalService
      .addModal(
        SleepDetectorCalibrationModalComponent,
        {
          calibrationValue:
            this.automationConfigs!.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue ??
            AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue,
        },
        {
          closeOnEscape: false,
        }
      )
      .pipe(filter(Boolean))
      .subscribe(async (data) => {
        await this.automationConfigService.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
          'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
          {
            calibrationValue: data.calibrationValue,
          }
        );
      });
  }
}
