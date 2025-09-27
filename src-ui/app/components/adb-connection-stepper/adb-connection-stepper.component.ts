import { Component, input } from '@angular/core';

export interface StepperStepState {
  icon: string;
  title: string;
  subtitle?: string;
  status: 'upcoming' | 'current' | 'complete';
}

@Component({
  selector: 'app-adb-connection-stepper',
  templateUrl: './adb-connection-stepper.component.html',
  styleUrls: ['./adb-connection-stepper.component.scss'],
  standalone: false,
})
export class ADBConnectionStepperComponent {
  public readonly steps = input.required<StepperStepState[]>();
}
