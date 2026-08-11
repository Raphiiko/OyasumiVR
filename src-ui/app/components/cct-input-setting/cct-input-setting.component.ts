import {
  ChangeDetectorRef,
  Component,
  computed,
  inject,
  Input,
  model,
  ChangeDetectionStrategy,
} from '@angular/core';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { fade } from '../../utils/animations';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-cct-input-setting',
  templateUrl: './cct-input-setting.component.html',
  styleUrl: './cct-input-setting.component.scss',
  animations: [fade()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class CCTInputSettingComponent {
  protected inputOpen = true;
  value = model<number>(6600);
  displayValue = computed(() => Math.floor(this.value()) + 'K');
  @Input() disabled = false;
  protected cctColor = 'black';
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    toObservable(this.value)
      .pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.cctColor = getCSSColorForCCT(value);
        this.cdr.markForCheck();
      });
  }

  openInput() {
    if (this.disabled) {
      this.inputOpen = false;
      return;
    }
    this.inputOpen = true;
  }

  protected updateValue(value: number) {
    this.value.set(value);
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
      if (Object.values(this.mouseInside).every((v) => !v)) {
        this.inputOpen = false;
        this.cdr.markForCheck();
      }
    }, 200);
  }
}
