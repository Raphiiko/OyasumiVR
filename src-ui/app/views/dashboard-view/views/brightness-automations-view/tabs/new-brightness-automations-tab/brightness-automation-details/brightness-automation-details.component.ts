import {
  Component,
  computed,
  DestroyRef,
  Input,
  input,
  OnInit,
  output,
  Signal,
} from '@angular/core';
import { fade, fadeRight, vshrink } from '../../../../../../../utils/animations';
import {
  BrightnessEvent,
  BrightnessEventAutomationConfig,
  SunBrightnessEventAutomationConfig,
} from '../../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../../services/automation-config.service';
import { map } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HardwareBrightnessControlService } from '../../../../../../../services/brightness-control/hardware-brightness-control.service';
import { SimpleBrightnessControlService } from '../../../../../../../services/brightness-control/simple-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../../../../../../services/brightness-control/software-brightness-control.service';
import { AppSettingsService } from '../../../../../../../services/app-settings.service';
import { invoke } from '@tauri-apps/api';
import { error } from 'tauri-plugin-log-api';

interface BrightnessBounds {
  min: number;
  max: number;
}

type BrightnessType = 'SIMPLE' | 'SOFTWARE' | 'HARDWARE';

@Component({
  selector: 'app-brightness-automation-details',
  templateUrl: './brightness-automation-details.component.html',
  styleUrls: ['./brightness-automation-details.component.scss'],
  animations: [fade(), fadeRight(), vshrink()],
})
export class BrightnessAutomationDetailsComponent implements OnInit {
  close = output<void>();
  eventId = input.required<BrightnessEvent>();
  advancedMode: Signal<boolean>;
  config: Signal<BrightnessEventAutomationConfig>;
  cctControlEnabled: Signal<boolean>;
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
  @Input() sunMode: 'SUNSET' | 'SUNRISE' | undefined;

  constructor(
    private automationConfigService: AutomationConfigService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    protected appSettingsService: AppSettingsService,
    private destroyRef: DestroyRef
  ) {
    this.cctControlEnabled = toSignal(
      this.appSettingsService.settings.pipe(map((s) => s.cctControlEnabled)),
      { initialValue: false }
    );
    const automationsConfig = toSignal(
      this.automationConfigService.configs.pipe(map((c) => c.BRIGHTNESS_AUTOMATIONS))
    );
    this.config = computed(() => automationsConfig()![this.eventId()]);
    this.advancedMode = computed(() => automationsConfig()!.advancedMode);
  }

  ngOnInit() {
    this.hardwareBrightnessControl.brightnessBounds
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (bounds) => {
        this.brightnessBounds.HARDWARE.min = bounds[0];
        this.brightnessBounds.HARDWARE.max = bounds[1];
      });
  }

  private async updateConfig(config: Partial<BrightnessEventAutomationConfig>) {
    await this.automationConfigService.updateAutomationConfig<BrightnessEventAutomationConfig>(
      'BRIGHTNESS_AUTOMATIONS',
      {
        [this.eventId()]: Object.assign(this.config(), config),
      }
    );
  }

  protected async updateBrightness(type: BrightnessType, value: number | 'CURRENT') {
    const copyCurrent = value === 'CURRENT';
    const pConfig: Partial<BrightnessEventAutomationConfig> = {};
    switch (type) {
      case 'SIMPLE': {
        if (copyCurrent) value = this.simpleBrightnessControl.brightness;
        pConfig.brightness = Math.round(value as number);
        break;
      }
      case 'SOFTWARE': {
        if (copyCurrent) value = this.softwareBrightnessControl.brightness;
        pConfig.softwareBrightness = Math.round(value as number);
        break;
      }
      case 'HARDWARE': {
        if (copyCurrent) value = this.hardwareBrightnessControl.brightness;
        pConfig.hardwareBrightness = Math.round(value as number);
        break;
      }
    }
    await this.updateConfig(pConfig);
    if (copyCurrent) {
      this.vshakeElements.push('BRIGHTNESS_' + type);
      setTimeout(() => {
        const index = this.vshakeElements.indexOf('BRIGHTNESS_' + type);
        if (index >= 0) this.vshakeElements.splice(index, 1);
      }, 300);
    }
  }

  protected async toggleChangeBrightness() {
    await this.updateConfig({
      changeBrightness: !this.config().changeBrightness,
    });
  }

  protected async toggleEnabled() {
    await this.updateConfig({
      enabled: !this.config().enabled,
    });
  }

  protected async toggleTransition() {
    await this.updateConfig({
      transition: !this.config().transition,
    });
  }

  protected async updateTransitionTime($event: number) {
    await this.updateConfig({
      transitionTime: $event,
    });
  }

  protected async toggleChangeColorTemperature() {
    await this.updateConfig({
      changeColorTemperature: !this.config().changeColorTemperature,
    });
  }

  protected async updateColorTemperature($event: number) {
    await this.updateConfig({
      colorTemperature: $event,
    });
  }

  protected asSunConfig(config: BrightnessEventAutomationConfig) {
    if (config.type === 'SUN') return config as SunBrightnessEventAutomationConfig;
    throw new Error('Tried casting non-sun config to sun config');
  }

  protected async toggleOnlyWhenSleepDisabled() {
    await this.updateConfig({
      onlyWhenSleepDisabled: !this.asSunConfig(this.config()).onlyWhenSleepDisabled,
    });
  }

  protected async updateActivationTime(value: string) {
    if (!value.match(/[0-9]{2}:[0-9]{2}/)) return;
    await this.updateConfig({
      activationTime: value,
    });
  }

  protected async autoDetermineActivationTime() {
    try {
      const [sunrise, sunset] = await invoke<[string, string]>('get_sunrise_sunset_time');
      switch (this.sunMode) {
        case 'SUNSET':
          await this.updateActivationTime(sunset);
          break;
        case 'SUNRISE': {
          await this.updateActivationTime(sunrise);
          break;
        }
      }
      this.vshakeElements.push('ACTIVATION_TIME');
      setTimeout(() => {
        const index = this.vshakeElements.indexOf('ACTIVATION_TIME');
        if (index >= 0) this.vshakeElements.splice(index, 1);
      }, 300);
    } catch (e) {
      error('[BrightnessAutomationDetails] Failed to get sunrise/sunset time: ' + e);
    }
  }
}
