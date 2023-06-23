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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ImageBrightnessControlService } from 'src-ui/app/services/brightness-control/image-brightness/image-brightness-control.service';
import { ImageBrightnessControlAutomationService } from 'src-ui/app/services/brightness-control/image-brightness/image-brightness-control-automation.service';

@Component({
  selector: 'app-image-brightness-automations-tab',
  templateUrl: './image-brightness-automations-tab.component.html',
  styleUrls: ['../../brightness-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class ImageBrightnessAutomationsTabComponent implements OnInit {
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
    AUTOMATION_CONFIGS_DEFAULT.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
  );
  protected onSleepModeDisableConfig: BrightnessOnSleepModeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
  );
  protected brightnessBounds = { min: 10, max: 100 }; // Enforce minimum 10% brightness
  protected brightnessSnapValues: number[] = [100];
  protected brightnessSnapDistance = 8;

  constructor(
    private automationConfigService: AutomationConfigService,
    protected brightnessControl: ImageBrightnessControlService,
    protected brightnessAutomation: ImageBrightnessControlAutomationService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.onSleepModeEnableConfig = configs.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE;
        this.onSleepModeDisableConfig = configs.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE;
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE',
            this.onSleepModeEnableConfig
          );
          this.transitionValueOnEnable = transitionValue;
          this.transitionUnitOptionOnEnable = transitionUnit;
        }
        {
          const [transitionValue, transitionUnit] = await this.parseTransitionSetting(
            'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE',
            this.onSleepModeDisableConfig
          );
          this.transitionValueOnDisable = transitionValue;
          this.transitionUnitOptionOnDisable = transitionUnit;
        }
      });
  }

  async setAutomationEnabled(automation: AutomationType, enabled: boolean) {
    await this.automationConfigService.updateAutomationConfig(automation, { enabled });
    // Cancel running transitions if disabling
    switch (automation) {
      case 'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        if (this.brightnessAutomation.isSleepEnableTransitionActive) {
          this.brightnessControl.cancelActiveTransition();
        }
        break;
      case 'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
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
      case 'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE':
        this.transitionValueOnEnable = transitionValue;
        this.transitionUnitOptionOnEnable = transitionUnit;
        break;
      case 'IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE':
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
