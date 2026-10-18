import { Component, OnInit, ChangeDetectionStrategy, input, output } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DropdownButtonComponent implements OnInit {
  readonly disabled = input(false);
  readonly items = input<DropdownItem[]>([]);
  readonly itemSelect = output<DropdownItem>();
  collapsed = true;

  constructor() {}

  ngOnInit(): void {}

  clickBox() {
    if (!this.collapsed || !this.disabled()) {
      this.collapsed = !this.collapsed;
    }
  }

  selectItem(item: DropdownItem, event: MouseEvent) {
    if (event.target instanceof HTMLElement && event.target.classList.contains('noselect')) return;
    if (!this.disabled()) {
      this.itemSelect.emit(item);
      this.collapsed = true;
    }
  }
}
