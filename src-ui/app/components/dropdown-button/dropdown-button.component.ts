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
  standalone: false,
})
export class DropdownButtonComponent implements OnInit {
  @Input() disabled = false;
  @Input() items: DropdownItem[] = [];
  @Output() itemSelect: EventEmitter<DropdownItem> = new EventEmitter();
  collapsed = true;

  constructor() {}

  ngOnInit(): void {}

  clickBox() {
    if (!this.collapsed || !this.disabled) {
      this.collapsed = !this.collapsed;
    }
  }

  selectItem(item: DropdownItem, event: MouseEvent) {
    if (event.target instanceof HTMLElement && event.target.classList.contains('noselect')) return;
    if (!this.disabled) {
      this.itemSelect.emit(item);
      this.collapsed = true;
    }
  }
}
