import { Component, OnInit } from '@angular/core';
import { SleepDetectionTabComponent } from '../sleep-detection-tab.component';
import { TimeDisableSleepModeModalComponent } from '../../modals/time-disable-sleepmode-modal/time-disable-sleep-mode-modal.component';
import { filter } from 'rxjs';
import {
  SleepModeDisableAfterTimeAutomationConfig,
  SleepModeDisableAtTimeAutomationConfig,
  SleepModeDisableOnDevicePowerOnAutomationConfig,
  SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig,
  SleepModeDisableOnUprightPoseAutomationConfig,
} from '../../../../../../models/automations';
import { DurationDisableSleepModeModalComponent } from '../../modals/duration-disable-sleepmode-modal/duration-disable-sleep-mode-modal.component';
import { DevicePowerOnDisableSleepModeModalComponent } from '../../modals/device-poweron-disable-sleepmode-modal/device-power-on-disable-sleep-mode-modal.component';
import { UprightPoseDisableSleepModeModalComponent } from '../../modals/upright-pose-disable-sleepmode-modal/upright-pose-disable-sleep-mode-modal.component';
import { PlayerJoinLeaveDisableSleepModeModalComponent } from '../../modals/player-join-leave-disable-sleepmode-modal/player-join-leave-disable-sleep-mode-modal.component';

@Component({
    selector: 'app-sleep-detection-sleep-disable-tab',
    templateUrl: './sleep-detection-sleep-disable-tab.component.html',
    styleUrls: ['./sleep-detection-sleep-disable-tab.component.scss'],
    standalone: false
})
export class SleepDetectionSleepDisableTabComponent
  extends SleepDetectionTabComponent
  implements OnInit
{
  constructor() {
    super();
  }

  ngOnInit() {
    super.ngOnInit();
  }

  openModal_DisableSleepModeAtTime() {
    this.modalService
      .addModal(TimeDisableSleepModeModalComponent, {
        time: this.automationConfigs.SLEEP_MODE_DISABLE_AT_TIME.time,
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableAtTimeAutomationConfig>(
          'SLEEP_MODE_DISABLE_AT_TIME',
          {
            time: data.time,
          }
        );
      });
  }

  openModal_DisableSleepModeAfterTime() {
    this.modalService
      .addModal(DurationDisableSleepModeModalComponent, {
        duration: this.automationConfigs.SLEEP_MODE_DISABLE_AFTER_TIME.duration,
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableAfterTimeAutomationConfig>(
          'SLEEP_MODE_DISABLE_AFTER_TIME',
          {
            duration: data.duration,
          }
        );
      });
  }

  openModal_DisableSleepModeOnDevicePowerOn() {
    this.modalService
      .addModal(DevicePowerOnDisableSleepModeModalComponent, {
        triggerClasses: this.automationConfigs.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON.triggerClasses,
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableOnDevicePowerOnAutomationConfig>(
          'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON',
          {
            triggerClasses: data.triggerClasses,
          }
        );
      });
  }

  openModal_DisableSleepModeOnUprightPose() {
    this.modalService
      .addModal(UprightPoseDisableSleepModeModalComponent, {
        duration: this.automationConfigs.SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE.duration,
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        this.automationConfigService.updateAutomationConfig<SleepModeDisableOnUprightPoseAutomationConfig>(
          'SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE',
          {
            duration: data.duration,
          }
        );
      });
  }

  openModal_DisableSleepModeOnPlayerJoinOrLeave() {
    this.modalService
      .addModal(PlayerJoinLeaveDisableSleepModeModalComponent, {
        config: structuredClone(this.automationConfigs.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE),
      })
      .pipe(filter(Boolean))
      .subscribe((data) => {
        if (!data.config) return;
        this.automationConfigService.updateAutomationConfig<SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig>(
          'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE',
          data.config
        );
      });
  }
}
