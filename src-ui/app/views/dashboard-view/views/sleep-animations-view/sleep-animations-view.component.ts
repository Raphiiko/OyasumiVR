import { Component, DestroyRef, OnInit } from '@angular/core';
import { hshrink, noop, vshrink } from '../../../../utils/animations';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import {
  SLEEPING_ANIMATION_PRESETS,
  SleepingAnimationPreset,
  SleepingAnimationPresetNote,
} from '../../../../models/sleeping-animation-presets';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepingAnimationsAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { SleepingPose } from '../../../../models/sleeping-pose';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { OscService } from '../../../../services/osc.service';
import { SleepingAnimationsAutomationService } from '../../../../services/osc-automations/sleeping-animations-automation.service';
import { SleepService } from '../../../../services/sleep.service';
import { ModalService } from '../../../../services/modal.service';
import { OscScript } from '../../../../models/osc-script';
import { open } from '@tauri-apps/api/shell';
import { SleepingAnimationPresetModalComponent } from '../../../../components/sleeping-animation-preset-modal/sleeping-animation-preset-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-sleep-animations-view',
  templateUrl: './sleep-animations-view.component.html',
  styleUrls: ['./sleep-animations-view.component.scss'],
  animations: [noop(), vshrink(), hshrink()],
})
export class SleepAnimationsViewComponent implements OnInit {
  oscOptionsExpanded = false;
  oscPresetOptions: SelectBoxItem[] = [
    {
      id: 'CUSTOM',
      label: 'oscAutomations.sleepingAnimations.customPreset',
    },
    ...SLEEPING_ANIMATION_PRESETS.map((preset) => ({
      id: preset.id,
      label: preset.name + '\n' + preset.versions,
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: preset.author },
      },
      infoAction: this.buildPresetInfoAction(preset),
    })),
  ];
  config: SleepingAnimationsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS
  );
  currentPose: SleepingPose = 'UNKNOWN';
  sleepingPoses: SleepingPose[] = ['SIDE_FRONT', 'SIDE_BACK', 'SIDE_LEFT', 'SIDE_RIGHT'];
  footLockActions: Array<'FOOT_LOCK' | 'FOOT_UNLOCK'> = ['FOOT_LOCK', 'FOOT_UNLOCK'];
  presetNotes: SleepingAnimationPresetNote[] = [];

  get showManualControl(): boolean {
    return this.config && this.config.preset === 'CUSTOM';
  }

  constructor(
    private automationConfig: AutomationConfigService,
    private osc: OscService,
    private sleepingAnimationsAutomation: SleepingAnimationsAutomationService,
    private sleep: SleepService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = cloneDeep(configs.SLEEPING_ANIMATIONS);
        this.oscOptionsExpanded = this.config && this.config.preset === 'CUSTOM';
        if (this.config.preset && this.config.preset !== 'CUSTOM') {
          this.presetNotes =
            SLEEPING_ANIMATION_PRESETS.find((preset) => preset.id === this.config.preset)!.notes ||
            [];
        }
      });
    this.sleep.pose.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((pose) => {
      this.currentPose = pose;
    });
  }

  async updateConfig(config: Partial<SleepingAnimationsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('SLEEPING_ANIMATIONS', config);
  }

  getPresetOptionForId(preset: string): SelectBoxItem | undefined {
    return this.oscPresetOptions.find((p) => p.id === preset);
  }

  async selectPreset(presetId: string) {
    const preset =
      presetId === 'CUSTOM'
        ? { oscScripts: {}, notes: [] }
        : SLEEPING_ANIMATION_PRESETS.find((preset) => preset.id === presetId)!;
    await this.updateConfig({ preset: presetId, oscScripts: preset.oscScripts });
    this.oscOptionsExpanded = presetId === 'CUSTOM';
    this.presetNotes = preset.notes || [];
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

  async updateFootLockReleaseWindow(value: number) {
    await this.updateConfig({ footLockReleaseWindow: value });
  }

  async setSleepingPosition(position: SleepingPose) {
    if (this.config.enabled) {
      await this.sleepingAnimationsAutomation.forcePose(position);
    } else {
      await this.osc.runScript(this.config.oscScripts[position]!);
    }
  }

  async setFootLock(enabled: boolean) {
    await this.osc.runScript(
      enabled ? this.config.oscScripts.FOOT_LOCK! : this.config.oscScripts.FOOT_UNLOCK!
    );
  }

  buildPresetInfoAction(preset: SleepingAnimationPreset): (() => void) | undefined {
    if (preset.infoLinks) {
      if (preset.infoLinks.length === 1) {
        return () => open(preset.infoLinks[0].url);
      } else if (preset.infoLinks.length > 1) {
        return () =>
          this.modalService.addModal(SleepingAnimationPresetModalComponent, { preset }).subscribe();
      }
    }
    return undefined;
  }
}
