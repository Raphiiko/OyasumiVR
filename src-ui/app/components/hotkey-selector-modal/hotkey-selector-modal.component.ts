import { ChangeDetectorRef, Component, DestroyRef, OnDestroy, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from '../../utils/animations';
import { fromEvent, map, merge, Subject, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HotkeyService } from '../../services/hotkey.service';

export interface HotkeySelectorInputModel {}

export interface HotkeySelectorOutputModel {
  hotkey: string;
}

@Component({
  selector: 'app-hotkey-selector-modal',
  templateUrl: './hotkey-selector-modal.component.html',
  styleUrls: ['./hotkey-selector-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class HotkeySelectorModalComponent
  extends BaseModalComponent<HotkeySelectorInputModel, HotkeySelectorOutputModel>
  implements OnInit, OnDestroy, HotkeySelectorInputModel
{
  modifiers = {
    Ctrl: false,
    Alt: false,
    Shift: false,
    Super: false,
  };
  key?: string;
  stopListeningForKeys = new Subject<void>();
  success = false;

  constructor(
    private destroyRef: DestroyRef,
    private hotkeyService: HotkeyService,
    private cdr: ChangeDetectorRef
  ) {
    super();
  }

  async ngOnDestroy() {
    this.stopListeningForKeys.complete();
    await this.hotkeyService.resume();
  }

  async ngOnInit() {
    await this.hotkeyService.pause();
    merge(fromEvent(document, 'keyup'), fromEvent(document, 'keydown'))
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        takeUntil(this.stopListeningForKeys),
        map((event) => event as KeyboardEvent)
      )
      .subscribe(async (event: KeyboardEvent) => {
        this.modifiers.Ctrl = event.ctrlKey;
        this.modifiers.Alt = event.altKey;
        this.modifiers.Shift = event.shiftKey;
        this.modifiers.Super = event.metaKey;
        if (event.type === 'keydown' && this.hotkeyService.isValidKey(event.key)) {
          this.key = event.key;
          const hotkey = this.hotkeyString;
          if (await this.hotkeyService.isValidHotkey(hotkey)) {
            this.stopListeningForKeys.next();
            this.success = true;
            setTimeout(() => {
              this.result = {
                hotkey,
              };
              this.close();
            }, 500);
          } else {
            this.key = undefined;
          }
        }
        this.cdr.detectChanges();
      });
  }

  get hotkeyString(): string {
    if (!this.key) return '';
    let str = '';
    if (this.modifiers.Ctrl) str += 'Ctrl+';
    if (this.modifiers.Alt) str += 'Alt+';
    if (this.modifiers.Shift) str += 'Shift+';
    if (this.modifiers.Super) str += 'Super+';
    str += this.key;
    return str;
  }

  get displayString(): string {
    let str = '';
    if (this.modifiers.Ctrl) str += 'Ctrl+';
    if (this.modifiers.Alt) str += 'Alt+';
    if (this.modifiers.Shift) str += 'Shift+';
    if (this.modifiers.Super) str += 'Win+';
    if (this.key) str += this.key;
    else if (str.length > 0) str = str.substring(0, str.length - 1);
    return str;
  }
}
