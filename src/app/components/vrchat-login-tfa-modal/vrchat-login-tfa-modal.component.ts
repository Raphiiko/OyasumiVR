import { Component, OnDestroy, OnInit } from '@angular/core';
import { SimpleModalComponent } from 'ngx-simple-modal';
import { fadeUp, hshrink, vshrink } from 'src/app/utils/animations';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  skip,
  Subject,
  takeUntil,
} from 'rxjs';

interface VRChatLoginTFAModalInputModel {
  lastCodeInvalid: boolean;
}

interface VRChatLoginTFAModalOutputModel {
  code: string | null;
}

@Component({
  selector: 'app-vrchat-login-tfa-modal',
  templateUrl: './vrchat-login-tfa-modal.component.html',
  styleUrls: ['./vrchat-login-tfa-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
})
export class VRChatLoginTFAModalComponent
  extends SimpleModalComponent<VRChatLoginTFAModalInputModel, VRChatLoginTFAModalOutputModel>
  implements OnInit, VRChatLoginTFAModalInputModel, OnDestroy
{
  lastCodeInvalid = false;
  private destroy$: Subject<void> = new Subject<void>();
  code: BehaviorSubject<string> = new BehaviorSubject<string>('');
  codeValid = false;
  error = '';

  constructor() {
    super();
  }

  ngOnInit(): void {
    if (this.lastCodeInvalid) this.error = 'comp.vrchat-login-tfa-modal.errors.LAST_CODE_INVALID';
    this.code
      .pipe(takeUntil(this.destroy$), distinctUntilChanged(), skip(1), debounceTime(300))
      .subscribe((code) => {
        if (/^[0-9]{6}$/.test(code)) {
          this.codeValid = true;
          this.error = '';
        } else {
          this.codeValid = false;
          if (this.lastCodeInvalid)
            this.error = 'comp.vrchat-login-tfa-modal.errors.INVALID_FORMAT';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }

  async login() {
    if (!this.codeValid) return;
    this.result = { code: this.code.value };
    await this.close();
  }

  async cancel() {
    this.result = { code: null };
    this.result.code = null;
    await this.close();
  }
}
