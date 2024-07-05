import { Component, computed, DestroyRef, input, OnInit, output, Signal } from '@angular/core';
import { fade, fadeRight, vshrink } from '../../../../../../../utils/animations';
import {
  BrightnessEvent,
  BrightnessEventAutomationConfig,
} from '../../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../../services/automation-config.service';
import { map } from 'rxjs';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HardwareBrightnessControlService } from '../../../../../../../services/brightness-control/hardware-brightness-control.service';
import { SimpleBrightnessControlService } from '../../../../../../../services/brightness-control/simple-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../../../../../../services/brightness-control/software-brightness-control.service';

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

  constructor(
    private readonly automationConfigService: AutomationConfigService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    private destroyRef: DestroyRef
  ) {
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
    const pConfig: Partial<BrightnessEventAutomationConfig> = {};
    switch (type) {
      case 'SIMPLE': {
        if (value === 'CURRENT') value = this.simpleBrightnessControl.brightness;
        pConfig.brightness = value;
        break;
      }
      case 'SOFTWARE': {
        if (value === 'CURRENT') value = this.softwareBrightnessControl.brightness;
        pConfig.softwareBrightness = value;
        break;
      }
      case 'HARDWARE': {
        if (value === 'CURRENT') value = this.hardwareBrightnessControl.brightness;
        pConfig.hardwareBrightness = value;
        break;
      }
    }
    await this.updateConfig(pConfig);
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
}
