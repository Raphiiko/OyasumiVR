import { Component, OnInit, ChangeDetectionStrategy, input, model } from '@angular/core';
import { TString } from '../../models/translatable-string';
import { fadeDown, fadeUp } from '../../utils/animations';
import { SafeHtml } from '@angular/platform-browser';

export interface SelectBoxItem<T = string> {
  id: T;
  label: TString;
  subLabel?: TString;
  infoAction?: () => void;
  htmlPrefix?: string | SafeHtml;
}

@Component({
  selector: 'app-select-box',
  templateUrl: './select-box.component.html',
  styleUrls: ['./select-box.component.scss'],
  animations: [fadeDown(), fadeUp()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SelectBoxComponent implements OnInit {
  readonly type = input<'SMALL' | 'NORMAL'>('NORMAL');
  readonly disabled = input(false);
  readonly placeholder = input<string>();
  readonly items = input<SelectBoxItem[]>([]);
  readonly showPlaceholderInDropdown = input(true);
  readonly selected = model<SelectBoxItem>();
  readonly expandUp = input<boolean | undefined>(false);
  collapsed = true;

  constructor() {}

  ngOnInit(): void {}

  clickBox() {
    if (!this.collapsed || !this.disabled()) {
      this.collapsed = !this.collapsed;
    }
  }

  select(item: SelectBoxItem, event: MouseEvent) {
    if (event.target instanceof HTMLElement && event.target.classList.contains('noselect')) return;
    if (!this.disabled()) {
      this.selected.set(item);
      this.collapsed = true;
    }
  }

  clickOutsideDropdown() {
    if (!this.collapsed) this.collapsed = true;
  }
}
