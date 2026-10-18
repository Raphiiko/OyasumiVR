import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { BrightnessEventAutomationConfig } from '../../../../../../../models/automations';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { hshrink, vshrink } from '../../../../../../../utils/animations';

@Component({
  selector: 'app-brightness-automation-config-label',
  templateUrl: './brightness-automation-config-label.component.html',
  styleUrls: ['./brightness-automation-config-label.component.scss'],
  animations: [vshrink(), hshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BrightnessAutomationConfigLabelComponent {
  public readonly advancedMode = input(false);
  public readonly config = input<BrightnessEventAutomationConfig>();
  protected readonly getCSSColorForCCT = getCSSColorForCCT;
}
