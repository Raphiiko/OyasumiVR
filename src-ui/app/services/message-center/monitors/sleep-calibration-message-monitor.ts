import { inject } from '@angular/core';
import { MessageMonitor } from './message-monitor';
import { AutomationConfigService } from '../../automation-config.service';
import { distinctUntilChanged, filter, map } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeEnableForSleepDetectorAutomationConfig,
} from 'src-ui/app/models/automations';
import { SleepDetectorCalibrationModalComponent } from 'src-ui/app/views/dashboard-view/views/sleep-detection-view/modals/sleep-detector-calibration-modal/sleep-detector-calibration-modal.component';
import { ModalService } from '../../modal.service';

export class SleepCalibrationMessageMonitor extends MessageMonitor {
  private automationConfig = inject(AutomationConfigService);
  private modalService = inject(ModalService);

  public override async init(): Promise<void> {
    // this.automationConfig.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
    //   'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
    //   {
    //     enabled: true,
    //     calibrationValue: 0.01,
    //   }
    // );
    this.automationConfig.configs
      .pipe(
        map((configs) => configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR),
        map((config) => ({
          config,
          calibrationRequired:
            config.enabled &&
            config.calibrationValue ===
              AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.calibrationValue,
        })),
        distinctUntilChanged((a, b) => a.calibrationRequired === b.calibrationRequired)
      )
      .subscribe(({ config, calibrationRequired }) => {
        if (calibrationRequired) {
          this.messageCenter.addMessage({
            id: 'sleepCalibrationRequired',
            title: 'message-center.messages.sleepCalibrationRequired.title',
            message: 'message-center.messages.sleepCalibrationRequired.message',
            hideable: true,
            type: 'info',
            actions: [
              {
                label: 'message-center.messages.sleepCalibrationRequired.calibrate',
                action: () => {
                  this.modalService
                    .addModal(
                      SleepDetectorCalibrationModalComponent,
                      {
                        calibrationValue:
                          config.calibrationValue ??
                          AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR
                            .calibrationValue,
                      },
                      {
                        closeOnEscape: false,
                      }
                    )
                    .pipe(filter(Boolean))
                    .subscribe(async (data) => {
                      await this.automationConfig.updateAutomationConfig<SleepModeEnableForSleepDetectorAutomationConfig>(
                        'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
                        {
                          calibrationValue: data.calibrationValue,
                        }
                      );
                    });
                },
              },
            ],
          });
        } else {
          this.messageCenter.removeMessage('sleepCalibrationRequired');
        }
      });
  }
}
