import { Component, DestroyRef, Input, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { fade, noop, vshrink } from '../../../../../../utils/animations';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  SetBrightnessAutomationConfig,
} from '../../../../../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { clamp } from '../../../../../../utils/number-utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BrightnessControlAutomationService } from 'src-ui/app/services/brightness-control/brightness-control-automation.service';
import { HardwareBrightnessControlService } from '../../../../../../services/brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../../../../../services/brightness-control/software-brightness-control.service';
import { SimpleBrightnessControlService } from '../../../../../../services/brightness-control/simple-brightness-control.service';
import { firstValueFrom } from 'rxjs';

interface BrightnessBounds {
  min: number;
  max: number;
}

type BrightnessType = 'SIMPLE' | 'SOFTWARE' | 'HARDWARE';

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['./brightness-automations-tab.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class BrightnessAutomationsTabComponent implements OnInit {
  protected transitionUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'shared.time.seconds',
    },
    {
      id: 'MINUTES',
      label: 'shared.time.minutes',
    },
  ];
  protected transitionUnitOptionOnEnable?: SelectBoxItem = this.transitionUnitOptions[0];
  protected transitionUnitOptionOnDisable?: SelectBoxItem = this.transitionUnitOptions[0];
  protected transitionUnitOptionOnPreparation?: SelectBoxItem = this.transitionUnitOptions[0];

  protected transitionValueOnEnable = 0;
  protected transitionValueOnDisable = 0;
  protected transitionValueOnPreparation = 0;

  protected onSleepModeEnableConfig: SetBrightnessAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: SetBrightnessAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );
  protected onSleepPreparationConfig: Omit<SetBrightnessAutomationConfig, 'applyOnStart'> =
    cloneDeep(AUTOMATION_CONFIGS_DEFAULT.SET_BRIGHTNESS_ON_SLEEP_PREPARATION);
  protected brightnessBounds: Record<BrightnessType, BrightnessBounds> = {
    SIMPLE: { min: 5, max: 100 },
    SOFTWARE: { min: 5, max: 100 },
    // Overridden later
    HARDWARE: { min: 100, max: 100 },
  };
  protected brightnessSnapValues: Record<BrightnessType, number[]> = {
    SIMPLE: [],
    SOFTWARE: [],
    HARDWARE: [100],
  };
  protected brightnessSnapDistance: Record<BrightnessType, number> = {
    SIMPLE: 0,
    SOFTWARE: 0,
    HARDWARE: 5,
  };
  protected vshakeElements: string[] = [];

  protected isSleepModeEnableTransitionActive =
    this.brightnessAutomation.isTransitionActive('SLEEP_MODE_ENABLE');
  protected isSleepModeDisableTransitionActive =
    this.brightnessAutomation.isTransitionActive('SLEEP_MODE_DISABLE');
  protected isSleepPreparationTransitionActive =
    this.brightnessAutomation.isTransitionActive('SLEEP_PREPARATION');

  @Input() public advancedMode = false;

  constructor(
    private automationConfigService: AutomationConfigService,
    protected brightnessAutomation: BrightnessControlAutomationService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.hardwareBrightnessControl.brightnessBounds
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (bounds) => {
        this.brightnessBounds.HARDWARE.min = bounds[0];
        this.brightnessBounds.HARDWARE.max = bounds[1];
      });

    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
        this.onSleepPreparationConfig = configs.SET_BRIGHTNESS_ON_SLEEP_PREPARATION;
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE',
            this.onSleepModeEnableConfig
          );
          this.transitionValueOnEnable = transitionValue;
          this.transitionUnitOptionOnEnable = transitionUnit;
        }
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE',
            this.onSleepModeDisableConfig
          );
          this.transitionValueOnDisable = transitionValue;
          this.transitionUnitOptionOnDisable = transitionUnit;
        }
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'SET_BRIGHTNESS_ON_SLEEP_PREPARATION',
            this.onSleepPreparationConfig
          );
          this.transitionValueOnPreparation = transitionValue;
          this.transitionUnitOptionOnPreparation = transitionUnit;
        }
      });
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
    // Cancel running transitions if disabling
    const cancelAllTransitions = () => {
      this.simpleBrightnessControl.cancelActiveTransition();
      this.softwareBrightnessControl.cancelActiveTransition();
      this.hardwareBrightnessControl.cancelActiveTransition();
    };
    switch (automation) {
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        if (await firstValueFrom(this.brightnessAutomation.isTransitionActive('SLEEP_MODE_ENABLE')))
          cancelAllTransitions();
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
        if (
          await firstValueFrom(this.brightnessAutomation.isTransitionActive('SLEEP_MODE_DISABLE'))
        )
          cancelAllTransitions();
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_PREPARATION':
        if (await firstValueFrom(this.brightnessAutomation.isTransitionActive('SLEEP_PREPARATION')))
          cancelAllTransitions();
        break;
    }
  }

  async toggleTransitioning(automation: AutomationType, transition: boolean) {
    await this.automationConfigService.updateAutomationConfig<SetBrightnessAutomationConfig>(
      automation,
      { transition }
    );
  }

  async updateBrightness(automation: AutomationType, type: BrightnessType, brightness: number) {
    const property = {
      SIMPLE: 'brightness',
      SOFTWARE: 'softwareBrightness',
      HARDWARE: 'hardwareBrightness',
    }[type];
    await this.automationConfigService.updateAutomationConfig<SetBrightnessAutomationConfig>(
      automation,
      { [property]: brightness }
    );
  }

  async toggleApplyOnStart(automation: AutomationType, applyOnStart: boolean) {
    await this.automationConfigService.updateAutomationConfig<SetBrightnessAutomationConfig>(
      automation,
      { applyOnStart }
    );
  }

  async onChangeTransition(
    automation: AutomationType,
    transitionValue: number,
    transitionUnit?: SelectBoxItem
  ) {
    switch (automation) {
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        this.transitionValueOnEnable = transitionValue;
        this.transitionUnitOptionOnEnable = transitionUnit;
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
        this.transitionValueOnDisable = transitionValue;
        this.transitionUnitOptionOnDisable = transitionUnit;
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_PREPARATION':
        this.transitionValueOnDisable = transitionValue;
        this.transitionUnitOptionOnDisable = transitionUnit;
        break;
    }
    let multiplier = 1000;
    switch (transitionUnit?.id) {
      case 'MINUTES':
        multiplier = 60000;
        break;
      case 'SECONDS':
        multiplier = 1000;
        break;
    }
    await this.automationConfigService.updateAutomationConfig<SetBrightnessAutomationConfig>(
      automation,
      {
        transitionTime: transitionValue * multiplier,
      }
    );
  }

  async updateBrightnessWithCurrent(automation: AutomationType, type: BrightnessType) {
    const brightness: number = await (async () => {
      switch (type) {
        case 'SIMPLE':
          return this.simpleBrightnessControl.brightness;
        case 'SOFTWARE':
          return this.softwareBrightnessControl.brightness;
        case 'HARDWARE':
          return this.hardwareBrightnessControl.brightness;
      }
    })();
    await this.updateBrightness(automation, type, brightness);
    this.vshakeElements.push(automation + '_' + type);
    setTimeout(() => {
      const index = this.vshakeElements.indexOf(automation + '_' + type);
      if (index >= 0) this.vshakeElements.splice(index, 1);
    }, 300);
  }

  private async parseTransitionSetting(
    automation: AutomationType,
    config: Pick<SetBrightnessAutomationConfig, 'transitionTime'>
  ): Promise<[number, SelectBoxItem]> {
    // Parse the value and unit
    const valueInSeconds = Math.round(config.transitionTime / 1000);
    const [value, unit, factor] =
      valueInSeconds >= 60
        ? [
            clamp(Math.round(valueInSeconds / 60), 1, 59),
            this.transitionUnitOptions.find((o) => o.id === 'MINUTES'),
            60,
          ]
        : [
            clamp(valueInSeconds, 1, 59),
            this.transitionUnitOptions.find((o) => o.id === 'SECONDS'),
            1,
          ];
    // Update setting if the stored value is not the same as the parsed value
    if (value * factor * 1000 != config.transitionTime) {
      await this.automationConfigService.updateAutomationConfig<SetBrightnessAutomationConfig>(
        automation,
        {
          transitionTime: value * factor * 1000,
        }
      );
    }
    // Return the parsed value and unit]
    return [value, unit!];
  }
}
