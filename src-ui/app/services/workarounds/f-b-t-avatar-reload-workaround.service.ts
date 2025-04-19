import { Injectable } from '@angular/core';
import { OpenVRService } from '../openvr.service';
import {
  asyncScheduler,
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  switchMap,
  take,
  throttleTime,
} from 'rxjs';
import { isEqual } from 'lodash';
import { OscService } from '../osc.service';
import { sleep } from '../../utils/promise-utils';
import { info } from '@tauri-apps/plugin-log';
import { SleepingAnimationsAutomationService } from '../osc-automations/sleeping-animations-automation.service';
import { VRChatService } from '../vrchat.service';
import { AutomationConfigService } from '../automation-config.service';

@Injectable({
  providedIn: 'root',
})
export class FBTAvatarReloadWorkaroundService {
  private enabled = false;

  constructor(
    private openvr: OpenVRService,
    private osc: OscService,
    private vrchat: VRChatService,
    private sleepAnimations: SleepingAnimationsAutomationService,
    private automationConfig: AutomationConfigService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEPING_ANIMATIONS.enableAvatarReloadOnFBTDisableWorkaround))
      .subscribe((enabled) => (this.enabled = enabled));
    this.openvr.devices
      .pipe(
        // Only run if this hotfix is enabled
        filter(() => this.enabled),
        // Detect all trackers turning off
        map((devices) =>
          devices
            .filter((d) => d.class === 'GenericTracker' && (d.canPowerOff || d.isTurningOff))
            .map((d) => d.serialNumber)
        ),
        pairwise(),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        filter(([prev, curr]) => prev.length > 0 && curr.length === 0),
        // Only run while VRChat is active
        switchMap(() => this.vrchat.vrchatProcessActive.pipe(take(1))),
        filter(Boolean),
        // Only trigger once every 5s max
        throttleTime(5000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => this.triggerHotfix());
  }

  private async triggerHotfix() {
    info(
      '[FBTAvatarReloadHotfix] All trackers have been turned off. Running hotfix to reload avatar'
    );
    // Wait for VRC to process the trackers fully turning off
    await sleep(3000);

    // Open the quick menu
    await this.osc.send_int('/input/QuickMenuToggleLeft', 0);
    await sleep(150);
    await this.osc.send_int('/input/QuickMenuToggleLeft', 1);
    await sleep(150);
    await this.osc.send_int('/input/QuickMenuToggleLeft', 0);

    // Wait a bit
    await sleep(500);

    // Close the quick menu
    await this.osc.send_int('/input/QuickMenuToggleLeft', 0);
    await sleep(150);
    await this.osc.send_int('/input/QuickMenuToggleLeft', 1);
    await sleep(150);
    await this.osc.send_int('/input/QuickMenuToggleLeft', 0);

    // Inform sleeping automations to reapply
    await sleep(3000);
    await this.sleepAnimations.retrigger();

    info('[FBTAvatarReloadHotfix] Hotfix applied');
  }
}
