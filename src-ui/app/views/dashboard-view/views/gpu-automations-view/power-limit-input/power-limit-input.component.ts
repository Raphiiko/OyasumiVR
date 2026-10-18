import { Component, OnInit, ChangeDetectionStrategy, input, model } from '@angular/core';
import { GPUPowerLimit } from '../../../../../models/gpu-device';
import { vshrink } from '../../../../../utils/animations';

@Component({
  selector: 'app-power-limit-input',
  templateUrl: './power-limit-input.component.html',
  styleUrls: ['./power-limit-input.component.scss'],
  animations: [vshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class PowerLimitInputComponent implements OnInit {
  readonly minPowerLimit = input(-1);
  readonly maxPowerLimit = input(-1);
  readonly defaultPowerLimit = input(-1);

  readonly powerLimit = model<GPUPowerLimit>();

  constructor() {}

  ngOnInit(): void {}

  toggleDefault() {
    const powerLimit = this.powerLimit();
    if (!powerLimit) return;
    this.powerLimit.set({ default: !powerLimit.default, limit: this.defaultPowerLimit() });
  }

  onSliderChange(value: number) {
    const powerLimit = this.powerLimit();
    if (!powerLimit) return;
    this.powerLimit.set({ default: false, limit: value });
  }

  get isEnabled() {
    return (
      this.powerLimit() &&
      this.minPowerLimit() >= 0 &&
      this.maxPowerLimit() > 0 &&
      this.defaultPowerLimit() >= 0
    );
  }
}
