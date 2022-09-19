import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
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
      id: 'GOGO_LOCO_1.7.0',
      label: 'GoGo Loco 1.7.0',
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: 'franada' },
      },
      infoLink: 'https://booth.pm/en/items/3290806',
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
      id: 'CUSTOM',
      label: 'Custom Animations',
    },
  ];
  config: SleepingAnimationsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS
  );
  footLockReleaseWindowError?: string;

  constructor(private automationConfig: AutomationConfigService) {
  }

  ngOnInit(): void {
    this.automationConfig.configs.pipe(takeUntil(this.destroy$)).subscribe((configs) => {
      this.config = cloneDeep(configs.SLEEPING_ANIMATIONS);
      if (this.config.preset === 'CUSTOM') this.oscOptionsExpanded = true;
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
      this.footLockReleaseWindowError = 'The release duration has to be at least 100ms.';
      return;
    }
    if (intValue > 5000) {
      this.footLockReleaseWindowError = 'The release duration cannot be more than 5000ms.';
      return;
    }
    this.footLockReleaseWindowError = undefined;
    await this.updateConfig({ footLockReleaseWindow: intValue });
  }
}
