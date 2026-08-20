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
import {
  twoFactorMethodFromError,
  VRChatTwoFactorMethod,
} from '../../services/vrchat-api/vrchat-api';

interface VRChatLoginModalInputModel {
  autoLogin?: boolean;
  newAccount?: boolean;
  keepActiveProfile?: boolean;
  twoFactorMethod?: VRChatTwoFactorMethod;
  initialError?: string;
  username?: string;
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
  newAccount = false;
  keepActiveProfile = false;
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
    this.vrchat.activeProfile
      .pipe(
        map((profile) => profile?.rememberCredentials ?? false),
        takeUntilDestroyed(this.destroyRef),
        take(1)
      )
      .subscribe(async (rememberCredentials) => {
        try {
          this.rememberCredentials = this.newAccount ? false : rememberCredentials;
          const credentials = this.newAccount ? null : await this.vrchat.loadCredentials();
          if (credentials) {
            this.username = credentials.username;
            this.password = credentials.password;
          }
          if (this.twoFactorMethod) {
            this.loggingIn = true;
            await this.loginWithTwoFactor(this.twoFactorMethod);
          } else {
            if (this.autoLogin && credentials) await this.login();
          }
        } catch (e) {
          this.setLoginError(e);
        } finally {
          this.loggingIn = false;
          this.cdr.markForCheck();
        }
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
      if (this.newAccount) await this.vrchat.loginNewAccount(this.username, this.password);
      else await this.vrchat.login(this.username, this.password, this.keepActiveProfile);
      await this.finishLogin();
    } catch (e) {
      const method = twoFactorMethodFromError(e);
      if (method) await this.loginWithTwoFactor(method);
      else this.setLoginError(e);
    } finally {
      this.loggingIn = false;
      this.cdr.markForCheck();
    }
  }

  private async loginWithTwoFactor(method: VRChatTwoFactorMethod) {
    let lastCodeInvalid = false;
    while (true) {
      this.error = '';
      this.cdr.markForCheck();
      try {
        const code = await this.get2FACode(lastCodeInvalid);
        if (!code) return;
        await this.vrchat.verify2FA(code, method);
        await this.finishLogin();
        return;
      } catch (e) {
        if (e === 'INVALID_CODE') {
          lastCodeInvalid = true;
          continue;
        }
        const nextMethod = twoFactorMethodFromError(e);
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
    } else if (!this.newAccount) {
      await this.vrchat.forgetCredentials();
    }
    await this.close();
  }

  private setLoginError(error: unknown) {
    switch (error) {
      case 'CHECK_EMAIL':
      case 'INVALID_CREDENTIALS':
      case 'PROFILE_MISMATCH':
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
    if (!this.rememberCredentials && !this.newAccount) await this.vrchat.forgetCredentials();
  }
}
