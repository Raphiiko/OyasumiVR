import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeDisableOnUprightPoseAutomationConfig,
} from '../../models/automations';

import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepingPose } from '../../models/sleeping-pose';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableOnUprightPoseAutomationService {
  private config: SleepModeDisableOnUprightPoseAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE
  );
  private lastPose?: { pose: SleepingPose; time: number };
  private disableTimeout?: number | NodeJS.Timeout;

  constructor(private automationConfig: AutomationConfigService, private sleep: SleepService) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE))
      .subscribe((config) => (this.config = config));

    this.sleep.pose
      .pipe(debounceTime(1000), distinctUntilChanged())
      .subscribe((pose) => this.processPoseChange(pose));
  }

  private processPoseChange(pose: SleepingPose) {
    if (this.disableTimeout) {
      clearTimeout(this.disableTimeout);
      this.disableTimeout = undefined;
    }
    if (!this.lastPose) {
      this.lastPose = { pose, time: Date.now() };
      return;
    }
    // Stop here if the automation is disabled
    if (!this.config.enabled) return;
    // Calculate parameters for this automation
    const lastPoseDuration = Date.now() - this.lastPose.time;
    const lastPoseLayingDown = ['SIDE_BACK', 'SIDE_LEFT', 'SIDE_RIGHT'].includes(
      this.lastPose.pose
    );
    const currentPoseUpright = ['SIDE_FRONT'].includes(pose);
    // Save the current pose as the last pose
    this.lastPose = { pose, time: Date.now() };
    // Only disable sleep mode if the user has been laying down previously but is now upright
    if (!lastPoseLayingDown || !currentPoseUpright) return;
    // Only disable sleep mode if the user has been laying down previously for enough time
    if (lastPoseDuration < 30000) {
      return;
    }
    this.disableTimeout = setTimeout(() => {
      this.disableTimeout = undefined;
      // Stop if the automation is no longer enabled
      if (!this.config.enabled) return;
      // Stop if we're not laying down anymore
      if (this.lastPose?.pose !== 'SIDE_FRONT') return;
      // Disable the sleep mode
      this.sleep.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE',
      });
    }, this.config.duration);
  }
}
