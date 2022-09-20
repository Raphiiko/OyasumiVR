import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepingAnimationsAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { filter, firstValueFrom, map, pairwise } from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepingPose } from '../../models/sleeping-pose';
import { OscService } from '../osc.service';
import { OscScript } from '../../models/osc-script';
import { getOscScriptDuration } from '../../utils/osc-script-utils';

@Injectable({
  providedIn: 'root',
})
export class SleepingAnimationsAutomationService {
  private config: SleepingAnimationsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService,
    private osc: OscService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEPING_ANIMATIONS))
      .subscribe((config) => (this.config = config));
    this.automationConfig.configs
      .pipe(
        map((configs) => configs.SLEEPING_ANIMATIONS),
        pairwise(),
        filter(
          ([oldConfig, newConfig]) =>
            oldConfig.enabled && !newConfig.enabled && newConfig.unlockFeetOnAutomationDisable
        )
      )
      .subscribe(() => {
        if (this.config.oscScripts.FOOT_UNLOCK) {
          console.log('unlocking feet');
          this.osc.queueScript(this.config.oscScripts.FOOT_UNLOCK!);
        }
      });
    this.sleep.pose.subscribe((pose) => this.onPoseChange(pose));
    this.sleep.mode.subscribe((sleepMode) => {
      if (sleepMode && this.config.lockFeetOnSleepModeEnable && this.config.oscScripts.FOOT_LOCK)
        this.osc.queueScript(this.config.oscScripts.FOOT_LOCK);
      if (
        !sleepMode &&
        this.config.unlockFeetOnSleepModeDisable &&
        this.config.oscScripts.FOOT_UNLOCK
      ) {
        this.osc.queueScript(this.config.oscScripts.FOOT_UNLOCK);
      }
    });
  }

  private async onPoseChange(pose: SleepingPose) {
    if (!this.config.enabled) return;
    if (this.config.onlyIfSleepModeEnabled && !(await firstValueFrom(this.sleep.mode))) return;
    if (this.config.onlyIfAllTrackersTurnedOff) {
      const devices = await firstValueFrom(this.openvr.devices);
      const allTrackersTurnedOff = !devices.find((d) => d.class === 'GenericTracker');
      if (allTrackersTurnedOff) return;
    }
    // Combine OSC scripts
    const script: OscScript = { version: 1, commands: [] };
    const enableFootUnlock = !!(
      this.config.releaseFootLockOnPoseChange &&
      this.config.oscScripts.FOOT_UNLOCK &&
      this.config.oscScripts.FOOT_UNLOCK
    );
    if (enableFootUnlock) script.commands.push(...this.config.oscScripts.FOOT_UNLOCK!.commands);
    let scriptTime = 0;
    if (this.config.oscScripts[pose]) {
      scriptTime = getOscScriptDuration(this.config.oscScripts[pose]!);
      script.commands.push(...this.config.oscScripts[pose]!.commands);
    }
    if (enableFootUnlock) {
      let minimumDelayRemainder = this.config.footLockReleaseWindow - scriptTime;
      if (minimumDelayRemainder > 0) {
        script.commands.push({ type: 'SLEEP', duration: minimumDelayRemainder });
      }
      script.commands.push(...this.config.oscScripts.FOOT_LOCK!.commands);
    }
    // Queue script
    this.osc.queueScript(script, 'SLEEPING_ANIMATION_AUTOMATION_POSE_CHANGE');
  }

  async forcePose(pose: SleepingPose) {
    this.sleep.forcePose(pose);
  }
}
