import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { GPUPowerLimit } from '../../../../../models/gpu-device';
import { vshrink } from '../../../../../utils/animations';

@Component({
  selector: 'app-power-limit-input',
  templateUrl: './power-limit-input.component.html',
  styleUrls: ['./power-limit-input.component.scss'],
  animations: [vshrink()],
})
export class PowerLimitInputComponent implements OnInit {
  @Input() minPowerLimit = -1;
  @Input() maxPowerLimit = -1;
  @Input() defaultPowerLimit = -1;

  @Input() powerLimit?: GPUPowerLimit;
  @Output() powerLimitChange: EventEmitter<GPUPowerLimit> = new EventEmitter<GPUPowerLimit>();

  constructor() {}

  ngOnInit(): void {}

  toggleDefault() {
    if (!this.powerLimit) return;
    this.powerLimit.default = !this.powerLimit?.default;
    this.powerLimit.limit = this.defaultPowerLimit;
    this.powerLimitChange.emit(this.powerLimit);
  }

  onSliderChange(value: number) {
    if (!this.powerLimit) return;
    this.powerLimit.default = false;
    this.powerLimit.limit = value;
    this.powerLimitChange.emit(this.powerLimit);
  }

  get isEnabled() {
    return (
      this.powerLimit &&
      this.minPowerLimit >= 0 &&
      this.maxPowerLimit > 0 &&
      this.defaultPowerLimit >= 0
    );
  }
}
