import { ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { combineLatest, firstValueFrom, map, Observable } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';
import { ModalService } from '../../services/modal.service';
import { VRChatService } from '../../services/vrchat-api/vrchat.service';
import { VRChatAccountProfile } from '../../models/vrchat-api-settings';
import { fadeUp, hshrink } from '../../utils/animations';

@Component({
  selector: 'app-vrchat-accounts-modal',
  templateUrl: './vrchat-accounts-modal.component.html',
  styleUrls: ['./vrchat-accounts-modal.component.scss'],
  animations: [fadeUp(), hshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class VRChatAccountsModalComponent extends BaseModalComponent<void, void> {
  busyProfileId: string | null = null;
  protected readonly sortedProfiles: Observable<VRChatAccountProfile[]>;

  constructor(
    protected vrchat: VRChatService,
    private modalService: ModalService,
    private translate: TranslocoService,
    private cdr: ChangeDetectorRef
  ) {
    super();
    this.sortedProfiles = combineLatest([this.vrchat.profiles, this.translate.langChanges$]).pipe(
      map(([profiles]) =>
        [...profiles].sort(
          (a, b) =>
            this.accountName(a).localeCompare(this.accountName(b), undefined, {
              sensitivity: 'base',
            }) || a.id.localeCompare(b.id)
        )
      )
    );
  }

  protected accountName(profile: VRChatAccountProfile): string {
    return (
      profile.displayName ||
      profile.username ||
      this.translate.translate('comp.vrchat-accounts-modal.unknownAccount')
    );
  }

  async activate(profile: VRChatAccountProfile): Promise<void> {
    if (this.busyProfileId || profile.secretLocked) return;
    const [activeProfile, user] = await Promise.all([
      firstValueFrom(this.vrchat.activeProfile),
      firstValueFrom(this.vrchat.user),
    ]);
    if (activeProfile?.id === profile.id && user) return;
    await this.close();
    await this.vrchat.activateProfile(profile.id).catch(() => this.vrchat.showLoginModal());
  }

  async disconnect(profile: VRChatAccountProfile): Promise<void> {
    if (this.busyProfileId) return;
    this.busyProfileId = profile.id;
    this.cdr.markForCheck();
    try {
      await this.vrchat.logout();
    } finally {
      this.busyProfileId = null;
      this.cdr.markForCheck();
    }
  }

  async addAccount(): Promise<void> {
    if (this.busyProfileId) return;
    await this.close();
    await this.vrchat.prepareNewLogin();
  }

  async forget(profile: VRChatAccountProfile): Promise<void> {
    if (this.busyProfileId) return;
    const result = await firstValueFrom(
      this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
        ConfirmModalComponent,
        {
          title: 'comp.vrchat-accounts-modal.forget.title',
          message: {
            string: 'comp.vrchat-accounts-modal.forget.message',
            values: { account: this.accountName(profile) },
          },
          confirmButtonText: 'comp.vrchat-accounts-modal.forget.confirm',
        }
      )
    );
    if (!result?.confirmed) return;
    this.busyProfileId = profile.id;
    this.cdr.markForCheck();
    try {
      await this.vrchat.removeProfile(profile.id);
    } finally {
      this.busyProfileId = null;
      this.cdr.markForCheck();
    }
  }
}
