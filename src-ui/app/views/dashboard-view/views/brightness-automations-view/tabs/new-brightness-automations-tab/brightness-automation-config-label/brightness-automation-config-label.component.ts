import { Component, Input } from '@angular/core';
import { BrightnessEventAutomationConfig } from '../../../../../../../models/automations';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { hshrink, vshrink } from '../../../../../../../utils/animations';

@Component({
  selector: 'app-brightness-automation-config-label',
  templateUrl: './brightness-automation-config-label.component.html',
  styleUrls: ['./brightness-automation-config-label.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class BrightnessAutomationConfigLabelComponent {
  @Input() public advancedMode = false;
  @Input() public config?: BrightnessEventAutomationConfig;
  protected readonly getCSSColorForCCT = getCSSColorForCCT;
}
