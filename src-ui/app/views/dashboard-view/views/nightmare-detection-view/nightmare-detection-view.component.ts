import { Component, DestroyRef, HostListener, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  NightmareDetectionAutomationsConfig,
  SoundEffectConfig,
} from '../../../../models/automations';

import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { clamp } from '../../../../utils/number-utils';
import { hshrink } from '../../../../utils/animations';

@Component({
  selector: 'app-nightmare-detection-view',
  templateUrl: './nightmare-detection-view.component.html',
  styleUrls: ['./nightmare-detection-view.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class NightmareDetectionViewComponent implements OnInit {
  protected config: NightmareDetectionAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.NIGHTMARE_DETECTION
  );
  protected durationUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'shared.time.seconds',
    },
    {
      id: 'MINUTES',
      label: 'shared.time.minutes',
    },
  ];
  protected durationUnitOption?: SelectBoxItem;
  protected durationValue = 0;

  constructor(
    private router: Router,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit() {
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.NIGHTMARE_DETECTION)
      )
      .subscribe(async (config) => {
        this.config = config;
        await this.parseDurationSetting(config).then(([value, unit]) => {
          this.durationValue = value;
          this.durationUnitOption = unit;
        });
      });
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'integrationsPageLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/settings/integrations']);
  }

  async onChangeDuration(value: number, unit?: SelectBoxItem) {
    let multiplier = 1000;
    switch (unit?.id) {
      case 'MINUTES':
        multiplier = 60000;
        break;
      case 'SECONDS':
        multiplier = 1000;
        break;
    }
    await this.automationConfigService.updateAutomationConfig<NightmareDetectionAutomationsConfig>(
      'NIGHTMARE_DETECTION',
      {
        periodDuration: value * multiplier,
      }
    );
  }

  private async parseDurationSetting(
    config: Pick<NightmareDetectionAutomationsConfig, 'periodDuration'>
  ): Promise<[number, SelectBoxItem]> {
    // Parse the value and unit
    const valueInSeconds = Math.round(config.periodDuration / 1000);
    const [value, unit, factor] =
      valueInSeconds >= 60
        ? [
            clamp(Math.round(valueInSeconds / 60), 1, 59),
            this.durationUnitOptions.find((o) => o.id === 'MINUTES'),
            60,
          ]
        : [
            clamp(valueInSeconds, 1, 59),
            this.durationUnitOptions.find((o) => o.id === 'SECONDS'),
            1,
          ];
    // Update setting if the stored value is not the same as the parsed value
    if (value * factor * 1000 != config.periodDuration) {
      await this.automationConfigService.updateAutomationConfig<NightmareDetectionAutomationsConfig>(
        'NIGHTMARE_DETECTION',
        {
          periodDuration: value * factor * 1000,
        }
      );
    }
    // Return the parsed value and unit
    return [value, unit!];
  }

  async updateThreshold(threshold: number) {
    await this.automationConfigService.updateAutomationConfig<NightmareDetectionAutomationsConfig>(
      'NIGHTMARE_DETECTION',
      {
        heartRateThreshold: threshold,
      }
    );
  }

  async toggleDisableSleepMode() {
    await this.automationConfigService.updateAutomationConfig<NightmareDetectionAutomationsConfig>(
      'NIGHTMARE_DETECTION',
      {
        disableSleepMode: !this.config.disableSleepMode,
      }
    );
  }

  async updateSound(config: SoundEffectConfig) {
    await this.automationConfigService.updateAutomationConfig<NightmareDetectionAutomationsConfig>(
      'NIGHTMARE_DETECTION',
      {
        sound: config,
      }
    );
  }
}
