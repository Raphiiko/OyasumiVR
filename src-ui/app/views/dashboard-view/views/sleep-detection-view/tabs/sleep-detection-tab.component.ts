import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfigs,
  AutomationType,
} from '../../../../../models/automations';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AutomationConfigService } from '../../../../../services/automation-config.service';
import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { ModalService } from '../../../../../services/modal.service';
import { TranslateService } from '@ngx-translate/core';
import { OVRDeviceClass } from '../../../../../models/ovr-device';

@Component({ template: '' })
export abstract class SleepDetectionTabComponent implements OnInit {
  protected automationConfigs: AutomationConfigs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  protected automationConfigService = inject(AutomationConfigService);
  protected destroyRef = inject(DestroyRef);
  protected modalService = inject(ModalService);
  protected translate = inject(TranslateService);

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => (this.automationConfigs = configs));
  }

  async toggleAutomation(automation: AutomationType, field = 'enabled') {
    await this.automationConfigService.updateAutomationConfig(automation, {
      [field]: !((this.automationConfigs[automation] as any)[field] as any),
    } as any);
  }

  protected getStringForDuration(duration: string): string {
    return getStringForDuration(this.translate, duration);
  }

  protected deviceClassesToString(classes: OVRDeviceClass[], tlkey_prefix: string): string {
    return classes.map((c) => this.translate.instant(tlkey_prefix + c)).join(', ');
  }
}

export function getStringForDuration(translate: TranslateService, duration: string): string {
  const [hours, minutes] = duration.split(':').map((v) => parseInt(v));
  if (hours && minutes) {
    return translate.instant(
      'sleep-detection.disableAutomations.afterTime.description.hoursAndMinutes',
      {
        hours,
        minutes,
      }
    );
  } else if (hours) {
    return translate.instant('sleep-detection.disableAutomations.afterTime.description.hours', {
      hours,
    });
  } else if (minutes) {
    return translate.instant('sleep-detection.disableAutomations.afterTime.description.minutes', {
      minutes,
    });
  } else {
    return '';
  }
}
