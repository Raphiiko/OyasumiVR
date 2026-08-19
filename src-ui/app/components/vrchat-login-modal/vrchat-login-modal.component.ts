import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import { VRChatService } from '../../services/vrchat-api/vrchat.service';
import { firstValueFrom, map, take } from 'rxjs';
import { VRChatLoginTFAModalComponent } from '../vrchat-login-tfa-modal/vrchat-login-tfa-modal.component';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalService } from '../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VRChatTwoFactorMethod } from '../../services/vrchat-api/vrchat-api';

interface VRChatLoginModalInputModel {
  autoLogin?: boolean;
  twoFactorMethod?: VRChatTwoFactorMethod;
  initialError?: string;
}

interface VRChatLoginModalOutputModel {}

@Component({
  selector: 'app-vrchat-login-modal',
  templateUrl: './vrchat-login-modal.component.html',
  styleUrls: ['./vrchat-login-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class VRChatLoginModalComponent
  extends BaseModalComponent<VRChatLoginModalInputModel, VRChatLoginModalOutputModel>
  implements OnInit, VRChatLoginModalInputModel
{
  username = '';
  password = '';
  loggingIn = false;
  error = '';
  rememberCredentials = false;
  autoLogin = false;
  twoFactorMethod?: VRChatTwoFactorMethod;
  initialError?: string;

  constructor(
    private vrchat: VRChatService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
    if (this.initialError) this.setLoginError(this.initialError);
    this.vrchat.settings
      .pipe(
        map((settings) => settings.rememberCredentials),
        takeUntilDestroyed(this.destroyRef),
        take(1)
      )
      .subscribe(async (rememberCredentials) => {
        this.rememberCredentials = rememberCredentials;
        const credentials = await this.vrchat.loadCredentials();
        if (credentials) {
          this.username = credentials.username;
          this.password = credentials.password;
        }
        if (this.twoFactorMethod) {
          this.loggingIn = true;
          await this.loginWithTwoFactor(this.twoFactorMethod);
          this.loggingIn = false;
        } else if (this.autoLogin && credentials) await this.login();
        this.cdr.markForCheck();
      });
  }

  get2FACode(lastCodeInvalid: boolean): Promise<string | null> {
    return firstValueFrom(
      this.modalService
        .addModal(
          VRChatLoginTFAModalComponent,
          {
            lastCodeInvalid,
            username: this.username,
          },
          {
            closeOnEscape: false,
          }
        )
        .pipe(map((output) => output?.code || null))
    );
  }

  async login() {
    if (this.loggingIn) return;
    this.loggingIn = true;
    this.error = '';
    try {
      await this.vrchat.login(this.username, this.password);
      await this.finishLogin();
    } catch (e) {
      const method = this.twoFactorMethodFromError(e);
      if (method) await this.loginWithTwoFactor(method);
      else this.setLoginError(e);
    }
    this.loggingIn = false;
    this.cdr.markForCheck();
  }

  private async loginWithTwoFactor(method: VRChatTwoFactorMethod) {
    let lastCodeInvalid = false;
    while (true) {
      this.error = '';
      this.cdr.markForCheck();
      const code = await this.get2FACode(lastCodeInvalid);
      if (!code) return;
      try {
        await this.vrchat.verify2FA(code, method);
        await this.finishLogin();
        return;
      } catch (e) {
        if (e === 'INVALID_CODE') {
          lastCodeInvalid = true;
          continue;
        }
        const nextMethod = this.twoFactorMethodFromError(e);
        if (nextMethod) {
          method = nextMethod;
          lastCodeInvalid = false;
          continue;
        }
        this.setLoginError(e);
        return;
      }
    }
  }

  private async finishLogin() {
    if (this.rememberCredentials && this.username && this.password) {
      await this.vrchat.rememberCredentials(this.username, this.password);
    }
    await this.close();
  }

  private twoFactorMethodFromError(error: unknown): VRChatTwoFactorMethod | undefined {
    switch (error) {
      case '2FA_TOTP_REQUIRED':
        return 'totp';
      case '2FA_EMAILOTP_REQUIRED':
        return 'emailotp';
      default:
        return undefined;
    }
  }

  private setLoginError(error: unknown) {
    switch (error) {
      case 'CHECK_EMAIL':
      case 'INVALID_CREDENTIALS':
      case 'UNEXPECTED_RESPONSE':
      case 'UNSUPPORTED_2FA_METHOD':
        this.error = `comp.vrchat-login-modal.errors.${error}`;
        break;
      default:
        this.error = `comp.vrchat-login-modal.errors.UNEXPECTED_RESPONSE`;
        break;
    }
  }

  async toggleRememberCredentials() {
    this.rememberCredentials = !this.rememberCredentials;
    if (!this.rememberCredentials) {
      await this.vrchat.forgetCredentials();
    }
  }
}
