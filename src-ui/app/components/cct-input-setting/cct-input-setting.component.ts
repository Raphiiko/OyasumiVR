import {
  Component,
  computed,
  model,
  ChangeDetectionStrategy,
  input,
  viewChild,
} from '@angular/core';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { SettingRowLift } from '../setting-row/setting-row-lift';
import { SliderComponent } from '../slider/slider.component';

let nextPopoverId = 0;

@Component({
  selector: 'app-cct-input-setting',
  templateUrl: './cct-input-setting.component.html',
  styleUrl: './cct-input-setting.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class CCTInputSettingComponent {
  value = model<number>(6600);
  displayValue = computed(() => Math.floor(this.value()) + 'K');
  readonly disabled = input(false);
  protected readonly cctColor = computed(() => getCSSColorForCCT(this.value()));
  protected readonly popoverId = `cct-input-${nextPopoverId++}`;
  protected readonly lift = new SettingRowLift();
  private readonly slider = viewChild.required(SliderComponent);

  /** Runs before popovertarget opens the panel, so the panel joins the top layer above the row. */
  protected raiseRow(panel: HTMLElement) {
    if (!panel.matches(':popover-open')) this.lift.raise();
  }

  protected onToggle(event: ToggleEvent, panel: HTMLElement) {
    if (event.newState !== 'open') {
      this.lift.lower();
      return;
    }
    // the slider measures its track width, which is zero while the panel is hidden
    this.slider().recalculateStyles();
    this.lift.place(panel);
  }
}
