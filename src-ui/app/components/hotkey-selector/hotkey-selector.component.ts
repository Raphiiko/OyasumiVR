import {
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ChangeDetectionStrategy,
} from '@angular/core';
import { hshrink, noop } from '../../utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import { HotkeySelectorModalComponent } from '../hotkey-selector-modal/hotkey-selector-modal.component';
import { HotkeyService } from 'src-ui/app/services/hotkey.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-hotkey-selector',
  templateUrl: './hotkey-selector.component.html',
  styleUrls: ['./hotkey-selector.component.scss'],
  animations: [hshrink(), noop()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class HotkeySelectorComponent implements OnChanges, OnDestroy, OnInit {
  @Input() action?: string;
  hotkey?: string;
  private hotkeySub?: Subscription;

  get selected(): boolean {
    return !!this.hotkey;
  }

  get hotkeyString(): string {
    return this.hotkey ?? '';
  }

  constructor(
    private modalService: ModalService,
    private hotkeyService: HotkeyService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.refreshHotkey();
  }

  async ngOnDestroy() {
    this.hotkeySub?.unsubscribe();
  }

  selectHotkey() {
    this.modalService.addModal(HotkeySelectorModalComponent, {}, {}).subscribe((result) => {
      if (!result?.hotkey || !this.action) return;
      this.hotkey = result.hotkey;
      this.hotkeyService.registerHotkey(this.action, this.hotkey);
      this.cdr.markForCheck();
    });
  }

  async deselectHotkey() {
    this.hotkey = undefined;
    if (this.action) await this.hotkeyService.unregisterHotkey(this.action);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['action'].previousValue !== changes['action'].currentValue) {
      this.refreshHotkey();
    }
  }

  refreshHotkey() {
    this.hotkeySub?.unsubscribe();
    if (this.action) {
      this.hotkeySub = this.hotkeyService.getHotkeyStringForId(this.action).subscribe((hotkey) => {
        this.hotkey = hotkey;
        this.cdr.markForCheck();
      });
    } else {
      this.hotkey = undefined;
    }
  }
}
