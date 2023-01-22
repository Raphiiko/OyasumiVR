import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
} from '@angular/core';
import { GPUPowerLimit } from '../../../../../models/gpu-device';
import { vshrink } from '../../../../../utils/animations';

@Component({
  selector: 'app-power-limit-input',
  templateUrl: './power-limit-input.component.html',
  styleUrls: ['./power-limit-input.component.scss'],
  animations: [vshrink()],
})
export class PowerLimitInputComponent implements OnInit, OnChanges {
  @Input() minPowerLimit: number = -1;
  @Input() maxPowerLimit: number = -1;
  @Input() defaultPowerLimit: number = -1;

  @Input() powerLimit?: GPUPowerLimit;
  @Output() powerLimitChange: EventEmitter<GPUPowerLimit> = new EventEmitter<GPUPowerLimit>();

  constructor() {}

  ngOnInit(): void {}

  ngOnChanges(changes: SimpleChanges) {}

  toggleDefault() {
    if (!this.powerLimit) return;
    this.powerLimit.default = !this.powerLimit?.default;
    this.powerLimit.limit = this.defaultPowerLimit;
    this.powerLimitChange.emit(this.powerLimit);
  }

  onSliderChange(value: string, emit: boolean) {
    if (!this.powerLimit) return;
    this.powerLimit.default = false;
    this.powerLimit.limit = parseInt(value);
    if (emit) this.powerLimitChange.emit(this.powerLimit);
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
