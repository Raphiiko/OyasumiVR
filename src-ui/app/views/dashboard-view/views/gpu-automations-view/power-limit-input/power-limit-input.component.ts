import {
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { GPUPowerLimit, GPUPowerLimitUnit } from '../../../../../models/gpu-device';
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
  @Input() minPowerLimit = -1;
  @Input() maxPowerLimit = -1;
  @Input() defaultPowerLimit = -1;
  @Input() unit: GPUPowerLimitUnit = 'W';

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

  /** Rounds down and prefixes positive AMD percentage offsets with a plus sign. */
  formatPowerLimit(value: number): string {
    const roundedValue = Math.floor(value);
    if (this.unit === '%') {
      return `${roundedValue > 0 ? '+' : ''}${roundedValue}%`;
    }

    return `${roundedValue}W`;
  }

  /** Formats a watt value against a positive maximum; callers must ensure that maximum is valid. */
  formatRelativePercentage(value: number): string {
    return `${Math.floor((value / this.maxPowerLimit) * 100)}%`;
  }

  /** Includes a fraction of maximum only for watt-based defaults. */
  get defaultLimitSummary(): string {
    if (this.unit === '%') {
      return `(${this.formatPowerLimit(this.defaultPowerLimit)})`;
    }

    return `(${this.formatPowerLimit(this.defaultPowerLimit)} / ${this.formatRelativePercentage(this.defaultPowerLimit)})`;
  }

  /** Shows the secondary percentage only for watt limits with a positive maximum. */
  get showRelativePercentage(): boolean {
    return this.unit === 'W' && this.maxPowerLimit > 0;
  }

  /** Requires finite bounds containing the default; negative percentage offsets remain valid. */
  get isEnabled() {
    return (
      this.powerLimit &&
      Number.isFinite(this.minPowerLimit) &&
      Number.isFinite(this.maxPowerLimit) &&
      Number.isFinite(this.defaultPowerLimit) &&
      this.maxPowerLimit > this.minPowerLimit &&
      this.defaultPowerLimit >= this.minPowerLimit &&
      this.defaultPowerLimit <= this.maxPowerLimit
    );
  }
}
