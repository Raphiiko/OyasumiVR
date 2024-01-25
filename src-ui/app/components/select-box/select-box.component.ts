import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
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
})
export class SelectBoxComponent implements OnInit {
  @Input() type: 'SMALL' | 'NORMAL' = 'NORMAL';
  @Input() disabled = false;
  @Input() placeholder?: string;
  @Input() items: SelectBoxItem[] = [];
  @Input() showPlaceholderInDropdown = true;
  @Input() selected?: SelectBoxItem | undefined;
  @Input() expandUp?: boolean = false;
  @Output() selectedChange: EventEmitter<SelectBoxItem | undefined> = new EventEmitter();
  collapsed = true;

  constructor() {}

  ngOnInit(): void {}

  clickBox() {
    if (!this.collapsed || !this.disabled) {
      this.collapsed = !this.collapsed;
    }
  }

  select(item: SelectBoxItem, event: MouseEvent) {
    if (event.target instanceof HTMLElement && event.target.classList.contains('noselect')) return;
    if (!this.disabled) {
      this.selected = item;
      this.selectedChange.emit(item);
      this.collapsed = true;
    }
  }

  clickOutsideDropdown() {
    if (!this.collapsed) this.collapsed = true;
  }
}
