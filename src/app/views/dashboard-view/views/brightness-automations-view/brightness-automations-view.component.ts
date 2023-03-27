import { Component, OnDestroy, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { vshrink } from '../../../../utils/animations';
import { Subject, takeUntil } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationType,
  DisplayBrightnessOnSleepModeAutomationConfig,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
} from '../../../../models/automations';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { clamp } from '../../../../utils/number-utils';
import { error } from 'tauri-plugin-log-api';

@Component({
  selector: 'app-brightness-automations-view',
  templateUrl: './brightness-automations-view.component.html',
  styleUrls: ['./brightness-automations-view.component.scss'],
  animations: [vshrink()],
})
export class BrightnessAutomationsViewComponent implements OnInit, OnDestroy {
  transitionUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'Seconds',
    },
    {
      id: 'MINUTES',
      label: 'Minutes',
    },
  ];
  transitionUnitOptionOnEnable?: SelectBoxItem = this.transitionUnitOptions[0];
  transitionUnitOptionOnDisable?: SelectBoxItem = this.transitionUnitOptions[0];

  transitionValueOnEnable = 0;
  transitionValueOnDisable = 0;

  private destroy$: Subject<void> = new Subject();
  protected onSleepModeEnableConfig: DisplayBrightnessOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: DisplayBrightnessOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );

  constructor(private automationConfigService: AutomationConfigService) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntil(this.destroy$))
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
  }

  ngOnDestroy(): void {}

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
  }

  async toggleTransitioning(automation: AutomationType, transition: boolean) {
    await this.automationConfigService.updateAutomationConfig<DisplayBrightnessOnSleepModeAutomationConfig>(
      automation,
      { transition }
    );
  }

  async updateBrightness(automation: AutomationType, brightness: number) {
    await this.automationConfigService.updateAutomationConfig<DisplayBrightnessOnSleepModeAutomationConfig>(
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
    await this.automationConfigService.updateAutomationConfig<DisplayBrightnessOnSleepModeAutomationConfig>(
      automation,
      {
        transitionTime: transitionValue * multiplier,
      }
    );
  }

  private async parseTransitionSetting(
    automation: AutomationType,
    config: DisplayBrightnessOnSleepModeAutomationConfig
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
      await this.automationConfigService.updateAutomationConfig<DisplayBrightnessOnSleepModeAutomationConfig>(
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
