import { Component, DestroyRef, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fadeUp, hshrink, vshrink } from 'src-ui/app/utils/animations';
import { BehaviorSubject, debounceTime, distinctUntilChanged, skip } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  extends BaseModalComponent<VRChatLoginTFAModalInputModel, VRChatLoginTFAModalOutputModel>
  implements OnInit, VRChatLoginTFAModalInputModel
{
  lastCodeInvalid = false;
  code: BehaviorSubject<string> = new BehaviorSubject<string>('');
  codeValid = false;
  error = '';

  constructor(private destroyRef: DestroyRef) {
    super();
  }

  ngOnInit(): void {
    if (this.lastCodeInvalid) this.error = 'comp.vrchat-login-tfa-modal.errors.LAST_CODE_INVALID';
    this.code
      .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged(), skip(1), debounceTime(300))
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
