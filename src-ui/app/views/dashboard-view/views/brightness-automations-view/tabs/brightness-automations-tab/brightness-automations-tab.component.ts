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
import { DisplayBrightnessControlService } from '../../../../../../services/brightness-control/display-brightness-control.service';
import { ImageBrightnessControlService } from '../../../../../../services/brightness-control/image-brightness-control.service';
import { SimpleBrightnessControlService } from '../../../../../../services/brightness-control/simple-brightness-control.service';

interface BrightnessBounds {
  min: number;
  max: number;
}

type BrightnessType = 'SIMPLE' | 'IMAGE' | 'DISPLAY';

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['../../brightness-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class BrightnessAutomationsTabComponent implements OnInit {
  protected transitionUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'Seconds',
    },
    {
      id: 'MINUTES',
      label: 'Minutes',
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
    IMAGE: { min: 5, max: 100 },
    // Overridden later
    DISPLAY: { min: 100, max: 100 },
  };
  protected brightnessSnapValues: Record<BrightnessType, number[]> = {
    SIMPLE: [],
    IMAGE: [],
    DISPLAY: [100],
  };
  protected brightnessSnapDistance: Record<BrightnessType, number> = {
    SIMPLE: 0,
    IMAGE: 0,
    DISPLAY: 5,
  };

  @Input() public advancedMode: boolean = false;

  constructor(
    private automationConfigService: AutomationConfigService,
    protected brightnessAutomation: BrightnessControlAutomationService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private imageBrightnessControl: ImageBrightnessControlService,
    private displayBrightnessControl: DisplayBrightnessControlService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.displayBrightnessControl.onDriverChange
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async () => {
        const bounds = await this.displayBrightnessControl.getBrightnessBounds();
        this.brightnessBounds.DISPLAY.min = bounds[0];
        this.brightnessBounds.DISPLAY.max = bounds[1];
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
      this.imageBrightnessControl.cancelActiveTransition();
      this.displayBrightnessControl.cancelActiveTransition();
    };
    switch (automation) {
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        if (this.brightnessAutomation.isSleepEnableTransitionActive) cancelAllTransitions();
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
        if (this.brightnessAutomation.isSleepDisableTransitionActive) cancelAllTransitions();
        break;
      case 'SET_BRIGHTNESS_ON_SLEEP_PREPARATION':
        if (this.brightnessAutomation.isSleepPreparationTransitionActive) cancelAllTransitions();
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
      IMAGE: 'imageBrightness',
      DISPLAY: 'displayBrightness',
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
