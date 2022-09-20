import { Component, OnDestroy, OnInit } from '@angular/core';
import { noop, vshrink } from '../../../../utils/animations';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepingAnimationsAutomationConfig,
} from '../../../../models/automations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { Subject, takeUntil } from 'rxjs';
import { cloneDeep } from 'lodash';
import { SleepingPose } from '../../../../models/sleeping-pose';
import { OscScript, SLEEPING_ANIMATION_OSC_SCRIPTS } from '../../../../models/osc-script';
import { OscService } from '../../../../services/osc.service';
import { SleepingAnimationsAutomationService } from '../../../../services/osc-automations/sleeping-animations-automation.service';
import { SleepService } from '../../../../services/sleep.service';

@Component({
  selector: 'app-osc-automations-view',
  templateUrl: './osc-automations-view.component.html',
  styleUrls: ['./osc-automations-view.component.scss'],
  animations: [noop(), vshrink()],
})
export class OscAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  activeTab: 'SLEEPING_ANIMATIONS' = 'SLEEPING_ANIMATIONS';
  oscOptionsExpanded = false;
  oscPresetOptions: SelectBoxItem[] = [
    {
      id: 'CUSTOM',
      label: 'oscAutomations.sleepingAnimations.customPreset',
    },
    {
      id: 'MMM_SLEEP_SYSTEM_2.2',
      label: 'ごろ寝システム v2.2',
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: 'んみんみーん' },
      },
      infoLink: 'https://booth.pm/ko/items/2886739',
    },
    {
      id: 'GOGO_LOCO_1.7.0',
      label: 'GoGo Loco 1.7.0',
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: 'franada' },
      },
      infoLink: 'https://booth.pm/en/items/3290806',
    },
  ];
  config: SleepingAnimationsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS
  );
  footLockReleaseWindowError?: string;
  currentPose: SleepingPose = 'UNKNOWN';
  get showManualControl(): boolean {
    return !!Object.values(this.config.oscScripts).find((s) => !!s);
  }

  constructor(
    private automationConfig: AutomationConfigService,
    private osc: OscService,
    private sleepingAnimationsAutomation: SleepingAnimationsAutomationService,
    private sleep: SleepService
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs.pipe(takeUntil(this.destroy$)).subscribe(async (configs) => {
      this.config = cloneDeep(configs.SLEEPING_ANIMATIONS);
      this.oscOptionsExpanded = this.config && this.config.preset === 'CUSTOM';
    });
    this.sleep.pose.pipe(takeUntil(this.destroy$)).subscribe((pose) => {
      this.currentPose = pose;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  async updateConfig(config: Partial<SleepingAnimationsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('SLEEPING_ANIMATIONS', config);
  }

  getPresetOptionForId(preset: string): SelectBoxItem | undefined {
    return this.oscPresetOptions.find((p) => p.id === preset);
  }

  async selectPreset(presetId: string) {
    const oscScripts = SLEEPING_ANIMATION_OSC_SCRIPTS[presetId];
    await this.updateConfig({ preset: presetId, oscScripts });
    this.oscOptionsExpanded = presetId === 'CUSTOM';
  }

  async updateOSCScript(scriptId: SleepingPose | 'FOOT_LOCK' | 'FOOT_UNLOCK', script?: OscScript) {
    if (script?.commands?.length === 0) {
      script = undefined;
    }
    await this.updateConfig({
      preset: 'CUSTOM',
      oscScripts: { ...this.config.oscScripts, [scriptId]: script },
    });
  }

  async updateFootLockReleaseWindow(value: string) {
    const intValue = parseInt(value);
    if (intValue <= 100) {
      this.footLockReleaseWindowError =
        'oscAutomations.sleepingAnimations.errors.releaseDurationTooShort';
      return;
    }
    if (intValue > 5000) {
      this.footLockReleaseWindowError =
        'oscAutomations.sleepingAnimations.errors.releaseDurationTooLong';
      return;
    }
    this.footLockReleaseWindowError = undefined;
    await this.updateConfig({ footLockReleaseWindow: intValue });
  }

  async setSleepingPosition(position: SleepingPose) {
    this.sleepingAnimationsAutomation.forcePose(position);
  }

  async setFootLock(enabled: boolean) {
    this.osc.queueScript(
      enabled ? this.config.oscScripts.FOOT_LOCK! : this.config.oscScripts.FOOT_UNLOCK!
    );
  }
}
