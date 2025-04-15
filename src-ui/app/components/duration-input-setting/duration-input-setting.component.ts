import { Component, computed, ElementRef, Input, model, ViewChild } from '@angular/core';
import { clamp } from '../../utils/number-utils';
import { fade } from '../../utils/animations';

@Component({
    selector: 'app-duration-input-setting',
    templateUrl: './duration-input-setting.component.html',
    styleUrl: './duration-input-setting.component.scss',
    animations: [fade()],
    standalone: false
})
export class DurationInputSettingComponent {
  value = model<number>(0);
  hours = computed(() => Math.floor(this.value() / 3600000));
  minutes = computed(() => Math.floor((this.value() % 3600000) / 60000));
  seconds = computed(() => Math.floor((this.value() % 60000) / 1000));
  displayValue = computed(() => {
    const hours = this.hours().toString().padStart(2, '0');
    const minutes = this.minutes().toString().padStart(2, '0');
    const seconds = this.seconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  });
  @ViewChild('hourInput') hourInput?: ElementRef;
  @ViewChild('minuteInput') minuteInput?: ElementRef;
  @ViewChild('secondInput') secondInput?: ElementRef;
  inputOpen = false;
  @Input() disabled = false;

  openInput() {
    if (this.disabled) {
      this.inputOpen = false;
      return;
    }
    this.inputOpen = true;
    setTimeout(() => {
      this.hourInput?.nativeElement?.focus();
    }, 50);
  }

  setSeconds($event: string) {
    if (this.disabled) {
      this.inputOpen = false;
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const seconds = clamp(parsed, 0, 60);
    this.value.set(this.hours() * 3600000 + this.minutes() * 60000 + seconds * 1000);
    if (parsed >= 10) {
      this.secondInput?.nativeElement?.blur();
      this.inputOpen = false;
    }
  }

  setMinutes($event: string) {
    if (this.disabled) {
      this.inputOpen = false;
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const minutes = clamp(parsed, 0, 60);
    this.value.set(this.hours() * 3600000 + minutes * 60000 + this.seconds() * 1000);
    if (parsed >= 10) this.secondInput?.nativeElement?.focus();
  }

  setHours($event: string) {
    if (this.disabled) {
      this.inputOpen = false;
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const hours = clamp(parsed, 0, 24);
    this.value.set(hours * 3600000 + this.minutes() * 60000 + this.seconds() * 1000);
    if (parsed >= 10) this.minuteInput?.nativeElement?.focus();
  }

  private mouseInside: Record<'INPUT' | 'CONTAINER', boolean> = {
    INPUT: false,
    CONTAINER: false,
  };

  protected mouseEnter(input: 'INPUT' | 'CONTAINER') {
    this.mouseInside[input] = true;
    if (!this.inputOpen) this.openInput();
  }

  protected mouseLeave(input: 'INPUT' | 'CONTAINER') {
    this.mouseInside[input] = false;
    setTimeout(() => {
      if (Object.values(this.mouseInside).every((v) => !v)) this.inputOpen = false;
    }, 200);
  }

  mouseClickInput() {
    if (this.inputOpen && this.hourInput?.nativeElement) {
      this.hourInput.nativeElement.focus();
    }
  }
}
