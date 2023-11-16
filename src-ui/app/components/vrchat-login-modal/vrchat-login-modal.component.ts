import { Component, DestroyRef, OnInit } from '@angular/core';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import { VRChatService } from '../../services/vrchat.service';
import { firstValueFrom, map, take } from 'rxjs';
import { VRChatLoginTFAModalComponent } from '../vrchat-login-tfa-modal/vrchat-login-tfa-modal.component';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalService } from '../../services/modal.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface VRChatLoginModalInputModel {
  autoLogin?: boolean;
}

interface VRChatLoginModalOutputModel {}

@Component({
  selector: 'app-vrchat-login-modal',
  templateUrl: './vrchat-login-modal.component.html',
  styleUrls: ['./vrchat-login-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
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

  constructor(
    private vrchat: VRChatService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {
    super();
  }

  async ngOnInit(): Promise<void> {
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
          if (this.autoLogin) this.login();
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
      await this.vrchat.login(this.username, this.password);
      this.loggingIn = false;
      if (this.rememberCredentials)
        await this.vrchat.rememberCredentials(this.username, this.password);
      await this.close();
    } catch (e) {
      switch (e) {
        case '2FA_TOTP_REQUIRED':
        case '2FA_EMAILOTP_REQUIRED':
        case '2FA_OTP_REQUIRED': {
          let lastCodeInvalid = false;
          while (true) {
            this.error = '';
            const code = await this.get2FACode(lastCodeInvalid);
            if (!code) break;
            const method: 'totp' | 'otp' | 'emailotp' = {
              '2FA_TOTP_REQUIRED': 'totp',
              '2FA_EMAILOTP_REQUIRED': 'emailotp',
              '2FA_OTP_REQUIRED': 'otp',
            }[e] as 'totp' | 'otp' | 'emailotp';
            try {
              await this.vrchat.verify2FA(code, method);
              this.loggingIn = false;
              if (this.rememberCredentials)
                await this.vrchat.rememberCredentials(this.username, this.password);
              await this.close();
            } catch (e) {
              switch (e) {
                case 'INVALID_CODE':
                  lastCodeInvalid = true;
                  continue;
                case 'UNEXPECTED_RESPONSE':
                  this.error = `comp.vrchat-login-modal.errors.${e}`;
                  break;
                default:
                  this.error = `comp.vrchat-login-modal.errors.UNEXPECTED_RESPONSE`;
                  break;
              }
            }
            break;
          }
          break;
        }
        case 'INVALID_CREDENTIALS':
        case 'CHECK_EMAIL':
        case 'UNEXPECTED_RESPONSE':
          this.error = `comp.vrchat-login-modal.errors.${e}`;
          break;
        default:
          this.error = `comp.vrchat-login-modal.errors.UNEXPECTED_RESPONSE`;
          break;
      }
    }
    this.loggingIn = false;
  }

  async toggleRememberCredentials() {
    this.rememberCredentials = !this.rememberCredentials;
    if (!this.rememberCredentials) {
      await this.vrchat.forgetCredentials();
    }
  }
}
