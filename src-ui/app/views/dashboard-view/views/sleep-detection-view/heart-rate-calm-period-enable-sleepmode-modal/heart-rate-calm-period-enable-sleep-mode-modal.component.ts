import { Component, HostBinding, HostListener, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren } from '../../../../../utils/animations';
import { Router } from '@angular/router';

export interface HeartRateCalmPeriodEnableSleepModeModalInputModel {
  duration: number;
  threshold: number;
}

export interface HeartRateCalmPeriodEnableSleepModeModalOutputModel {
  duration: number;
  threshold: number;
}

@Component({
  selector: 'app-heart-rate-calm-period-enable-sleepmode-modal',
  templateUrl: './heart-rate-calm-period-enable-sleep-mode-modal.component.html',
  styleUrls: ['./heart-rate-calm-period-enable-sleep-mode-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren()],
})
export class HeartRateCalmPeriodEnableSleepModeModalComponent
  extends BaseModalComponent<
    HeartRateCalmPeriodEnableSleepModeModalInputModel,
    HeartRateCalmPeriodEnableSleepModeModalOutputModel
  >
  implements OnInit, HeartRateCalmPeriodEnableSleepModeModalInputModel
{
  duration: number = 0;
  threshold: number = 0;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  @HostListener('click', ['$event'])
  onClick(event: MouseEvent) {
    if ((event.target as HTMLElement).className !== 'integrationsPageLink') return;
    event.preventDefault();
    this.router.navigate(['/dashboard/settings'], { fragment: 'INTEGRATIONS' });
    this.close();
  }

  constructor(private router: Router) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = this;
    this.close();
  }

  onDurationChange(minutes: number) {
    this.duration = minutes * 60 * 1000;
  }
}
