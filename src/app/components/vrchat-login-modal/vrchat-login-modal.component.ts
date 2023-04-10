import { Component, OnInit } from '@angular/core';
import { SimpleModalComponent, SimpleModalService } from 'ngx-simple-modal';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import { VRChatService } from '../../services/vrchat.service';
import { firstValueFrom, map } from 'rxjs';
import { VRChatLoginTFAModalComponent } from '../vrchat-login-tfa-modal/vrchat-login-tfa-modal.component';

interface VRChatLoginModalInputModel {}

interface VRChatLoginModalOutputModel {}

@Component({
  selector: 'app-vrchat-login-modal',
  templateUrl: './vrchat-login-modal.component.html',
  styleUrls: ['./vrchat-login-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
})
export class VRChatLoginModalComponent
  extends SimpleModalComponent<VRChatLoginModalInputModel, VRChatLoginModalOutputModel>
  implements OnInit, VRChatLoginModalInputModel
{
  username = '';
  password = '';
  loggingIn = false;
  error = '';

  constructor(private vrchat: VRChatService, private modalService: SimpleModalService) {
    super();
  }

  ngOnInit(): void {}

  get2FACode(lastCodeInvalid: boolean): Promise<string | null> {
    return firstValueFrom(
      this.modalService
        .addModal(
          VRChatLoginTFAModalComponent,
          {
            lastCodeInvalid,
          },
          {
            closeOnEscape: false,
            closeOnClickOutside: false,
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
            if (!code) {
              await this.close();
              return;
            }
            const method: 'totp' | 'otp' | 'emailotp' = {
              '2FA_TOTP_REQUIRED': 'totp',
              '2FA_EMAILOTP_REQUIRED': 'emailotp',
              '2FA_OTP_REQUIRED': 'otp',
            }[e] as 'totp' | 'otp' | 'emailotp';
            try {
              await this.vrchat.verify2FA(code, method);
              this.loggingIn = false;
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
}
