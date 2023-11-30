import { Component, DestroyRef, Input, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { hshrink, noop } from '../../utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import { HotkeySelectorModalComponent } from '../hotkey-selector-modal/hotkey-selector-modal.component';
import { HotkeyService } from 'src-ui/app/services/hotkey.service';
import { AppSettingsService } from '../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { delay, Subscription } from 'rxjs';

@Component({
  selector: 'app-hotkey-selector',
  templateUrl: './hotkey-selector.component.html',
  styleUrls: ['./hotkey-selector.component.scss'],
  animations: [hshrink(), noop()],
})
export class HotkeySelectorComponent implements OnChanges, OnDestroy {
  @Input() action?: string;
  hotkey?: string;
  private hotkeySub?: Subscription;

  get selected(): boolean {
    return !!this.hotkey;
  }

  get hotkeyString(): string {
    return this.hotkey ?? '';
  }

  constructor(private modalService: ModalService, private hotkeyService: HotkeyService) {}

  async ngOnInit() {
    this.refreshHotkey();
  }

  async ngOnDestroy() {
    this.hotkeySub?.unsubscribe();
  }

  selectHotkey() {
    this.modalService.addModal(HotkeySelectorModalComponent, {}, {}).subscribe((result) => {
      this.hotkey = result?.hotkey ?? undefined;
      if (this.hotkey) this.hotkeyService.registerHotkey(this.action!, this.hotkey);
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
      });
    } else {
      this.hotkey = undefined;
    }
  }
}
