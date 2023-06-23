import { Component, DestroyRef, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { fade, noop, vshrink } from '../../../../../../utils/animations';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  BrightnessOnSleepModeAutomationConfig,
} from '../../../../../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { clamp } from '../../../../../../utils/number-utils';
import { DisplayBrightnessControlService } from '../../../../../../services/brightness-control/display-brightness/display-brightness-control.service';
import { DisplayBrightnessControlAutomationService } from '../../../../../../services/brightness-control/display-brightness/display-brightness-control-automation.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-display-brightness-automations-tab',
  templateUrl: './display-brightness-automations-tab.component.html',
  styleUrls: ['../../brightness-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class DisplayBrightnessAutomationsTabComponent implements OnInit {
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

  protected transitionValueOnEnable = 0;
  protected transitionValueOnDisable = 0;

  protected onSleepModeEnableConfig: BrightnessOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: BrightnessOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );
  protected brightnessControlAvailable = false;
  protected brightnessBounds = { min: 0, max: 100 };
  protected brightnessSnapValues: number[] = [];
  protected brightnessSnapDistance = 8;

  constructor(
    private automationConfigService: AutomationConfigService,
    protected brightnessControl: DisplayBrightnessControlService,
    protected brightnessAutomation: DisplayBrightnessControlAutomationService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE',
            this.onSleepModeEnableConfig
          );
          this.transitionValueOnEnable = transitionValue;
          this.transitionUnitOptionOnEnable = transitionUnit;
        }
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE',
            this.onSleepModeDisableConfig
          );
          this.transitionValueOnDisable = transitionValue;
          this.transitionUnitOptionOnDisable = transitionUnit;
        }
      });
    this.brightnessControl
      .driverIsAvailable()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (available) => {
        this.brightnessControlAvailable = available;
        if (available) {
          const [min, max] = await this.brightnessControl.getBrightnessBounds();
          this.brightnessBounds = { min, max };
          this.brightnessSnapValues = [];
          this.brightnessSnapDistance = 1;
          if (min < 100 && max > 100) {
            this.brightnessSnapValues = [100];
          }
          this.brightnessSnapDistance = Math.round((max - min) / 20);
        }
      });
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
    // Cancel running transitions if disabling
    switch (automation) {
      case 'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        if (this.brightnessAutomation.isSleepEnableTransitionActive) {
          this.brightnessControl.cancelActiveTransition();
        }
        break;
      case 'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
        if (this.brightnessAutomation.isSleepDisableTransitionActive) {
          this.brightnessControl.cancelActiveTransition();
        }
        break;
    }
  }

  async toggleTransitioning(automation: AutomationType, transition: boolean) {
    await this.automationConfigService.updateAutomationConfig<BrightnessOnSleepModeAutomationConfig>(
      automation,
      { transition }
    );
  }

  async updateBrightness(automation: AutomationType, brightness: number) {
    await this.automationConfigService.updateAutomationConfig<BrightnessOnSleepModeAutomationConfig>(
      automation,
      { brightness }
    );
  }

  async onChangeTransition(
    automation: AutomationType,
    transitionValue: number,
    transitionUnit?: SelectBoxItem
  ) {
    switch (automation) {
      case 'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        this.transitionValueOnEnable = transitionValue;
        this.transitionUnitOptionOnEnable = transitionUnit;
        break;
      case 'DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
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
    await this.automationConfigService.updateAutomationConfig<BrightnessOnSleepModeAutomationConfig>(
      automation,
      {
        transitionTime: transitionValue * multiplier,
      }
    );
  }

  private async parseTransitionSetting(
    automation: AutomationType,
    config: BrightnessOnSleepModeAutomationConfig
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
      await this.automationConfigService.updateAutomationConfig<BrightnessOnSleepModeAutomationConfig>(
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
