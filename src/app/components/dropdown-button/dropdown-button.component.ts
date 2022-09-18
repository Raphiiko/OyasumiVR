import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { TString } from '../../models/translatable-string';
import { fadeDown } from '../../utils/animations';

export interface DropdownItem {
  id: string;
  label: TString;
  subLabel?: TString;
  infoLink?: string;
}

@Component({
  selector: 'app-dropdown-button',
  templateUrl: './dropdown-button.component.html',
  styleUrls: ['./dropdown-button.component.scss'],
  animations: [fadeDown()],
})
export class DropdownButtonComponent implements OnInit {
  @Input() disabled = false;
  @Input() items: DropdownItem[] = [];
  @Output() onSelect: EventEmitter<DropdownItem> = new EventEmitter();
  collapsed = true;

  constructor() {}

  ngOnInit(): void {}

  clickBox() {
    if (!this.collapsed || !this.disabled) {
      this.collapsed = !this.collapsed;
    }
  }

  select(item: DropdownItem, event: MouseEvent) {
    if (event.target instanceof HTMLElement && event.target.classList.contains('noselect')) return;
    if (!this.disabled) {
      this.onSelect.emit(item);
      this.collapsed = true;
    }
  }
}
