import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepingAnimationsAutomationConfig,
} from '../../models/automations';

import {
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  pairwise,
  startWith,
  Subject,
} from 'rxjs';
import { SleepService } from '../sleep.service';
import { SleepingPose } from '../../models/sleeping-pose';
import { OscService } from '../osc.service';
import { OscScript } from '../../models/osc-script';
import { getOscScriptDuration } from '../../utils/osc-script-utils';
import { VRChatService } from '../vrchat-api/vrchat.service';
import { AvatarContextService } from '../avatar-context.service';

@Injectable({
  providedIn: 'root',
})
export class SleepingAnimationsAutomationService {
  private config: SleepingAnimationsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS
  );
  private retrigger$ = new Subject<void>();

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService,
    private osc: OscService,
    private vrchat: VRChatService,
    private avatarContext: AvatarContextService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEPING_ANIMATIONS))
      .subscribe((config) => (this.config = config));
    this.subscribeToPoseChanges();
    this.subscribeToSleepMode();
    this.subscribeToAutomationState();
  }

  private subscribeToPoseChanges() {
    // Respond to sleeping pose changes
    combineLatest([
      // Pose changes
      this.sleep.pose,
      // External retriggers
      this.retrigger$.pipe(startWith(void 0)),
      // Retrigger when automation is enabled
      this.automationConfig.configs.pipe(
        map((configs) => configs.SLEEPING_ANIMATIONS.enabled),
        startWith(false),
        pairwise(),
        filter(([oldIsEnabled, newIsEnabled]) => !oldIsEnabled && newIsEnabled),
        startWith(false)
      ),
      // Retrigger when sleep mode is enabled
      this.sleep.mode.pipe(
        startWith(false),
        pairwise(),
        filter(([oldSleepMode, newSleepMode]) => !oldSleepMode && newSleepMode),
        startWith(false)
      ),
      // Retrigger when the avatar is changed
      this.avatarContext.avatarContext.pipe(
        map((ctx) => ctx?.id),
        distinctUntilChanged(),
        filter(Boolean),
        delay(3000)
      ),
    ])
      .pipe(debounceTime(0))
      .subscribe(async ([pose]) => {
        if (!this.config.enabled) return;
        if (this.config.onlyIfSleepModeEnabled && !(await firstValueFrom(this.sleep.mode))) return;
        // Combine OSC scripts
        const script: OscScript = { version: 3, commands: [] };
        // Foot unlock script
        const enableFootUnlock = !!(
          this.config.releaseFootLockOnPoseChange && this.config.oscScripts.FOOT_UNLOCK
        );
        const enableFootLock = !!(
          this.config.releaseFootLockOnPoseChange && this.config.oscScripts.FOOT_LOCK
        );
        if (enableFootUnlock) script.commands.push(...this.config.oscScripts.FOOT_UNLOCK!.commands);
        // Pose script
        let scriptTime = 0;
        if (this.config.oscScripts[pose]) {
          scriptTime = getOscScriptDuration(this.config.oscScripts[pose]!);
          script.commands.push(...this.config.oscScripts[pose]!.commands);
        }
        // Foot lock script
        if (enableFootLock) {
          const minimumDelayRemainder = this.config.footLockReleaseWindow - scriptTime;
          if (minimumDelayRemainder > 0) {
            script.commands.push({ type: 'SLEEP', duration: minimumDelayRemainder });
          }
          script.commands.push(...this.config.oscScripts.FOOT_LOCK!.commands);
        }
        // Queue script
        this.osc.queueScript(script, 'SLEEPING_ANIMATION_AUTOMATION_POSE_CHANGE');
      });
  }

  private subscribeToSleepMode() {
    // Lock feet on sleep mode enable
    // Unlock feet on sleep mode disable
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

  private subscribeToAutomationState() {
    // Unlock feet on automation disabled
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
          this.osc.queueScript(this.config.oscScripts.FOOT_UNLOCK!);
        }
      });
  }

  async forcePose(pose: SleepingPose) {
    this.sleep.forcePose(pose);
  }

  async retrigger() {
    this.retrigger$.next();
  }
}
