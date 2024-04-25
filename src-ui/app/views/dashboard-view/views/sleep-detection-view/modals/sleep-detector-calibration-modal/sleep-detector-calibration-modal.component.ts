import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../../utils/animations';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { SleepModeForSleepDetectorAutomationService } from '../../../../../../services/sleep-detection-automations/sleep-mode-for-sleep-detector-automation.service';

export interface SleepDetectorCalibrationModalInputModel {
  calibrationValue?: number;
}

export interface SleepDetectorCalibrationModalOutputModel {
  calibrationValue?: number;
}

@Component({
  selector: 'app-sleep-detector-enable-sleep-mode-modal',
  templateUrl: './sleep-detector-calibration-modal.component.html',
  styleUrls: ['./sleep-detector-calibration-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren(), vshrink()],
})
export class SleepDetectorCalibrationModalComponent
  extends BaseModalComponent<
    SleepDetectorCalibrationModalInputModel,
    SleepDetectorCalibrationModalOutputModel
  >
  implements OnInit, SleepDetectorCalibrationModalInputModel
{
  calibrationValue?: number;
  mode: 'INFO' | 'PREPARE' | 'COUNTDOWN' | 'CALIBRATING' | 'DONE' | 'FAILED' = 'INFO';
  countdownValue = 5;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(
    protected openvr: OpenVRService,
    private automation: SleepModeForSleepDetectorAutomationService
  ) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = this;
    this.close();
  }

  startCalibration() {
    if (this.mode === 'INFO') {
      this.mode = 'PREPARE';
    } else if (this.mode === 'PREPARE' || this.mode === 'DONE') {
      this.countdownValue = 5;
      for (let i = 1; i <= 5; i++) {
        setTimeout(() => {
          this.countdownValue--;
          if (i === 5) {
            this.mode = 'CALIBRATING';
            this.countdownValue = 10;
            for (let i = 1; i <= 10; i++) {
              setTimeout(async () => {
                this.countdownValue--;
                if (i === 10) {
                  const newValue = await this.automation.calibrate();
                  if (newValue > 0) {
                    this.calibrationValue = newValue;
                    this.mode = 'DONE';
                  } else {
                    this.mode = 'FAILED';
                  }
                }
              }, 1000 * i);
            }
          }
        }, 1000 * i);
      }
      this.mode = 'COUNTDOWN';
    }
  }
}
