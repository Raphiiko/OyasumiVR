import { AfterViewInit, Component, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { VRChatService } from '../../services/vrchat.service';
import { firstValueFrom } from 'rxjs';
import { fadeUp, vshrink } from '../../utils/animations';
import { AvatarEx } from '../../models/vrchat';
import { ModalService } from '../../services/modal.service';
import { ConfirmModalComponent } from '../confirm-modal/confirm-modal.component';

export interface VrcAvatarSelectModalInput {}

export interface VrcAvatarSelectModalOutput {
  avatar?: AvatarEx | null;
}

@Component({
  selector: 'app-vrc-avatar-select-modal',
  templateUrl: './vrc-avatar-select-modal.component.html',
  styleUrls: ['./vrc-avatar-select-modal.component.scss'],
  animations: [fadeUp(), vshrink()],
  standalone: false,
})
export class VrcAvatarSelectModalComponent
  extends BaseModalComponent<VrcAvatarSelectModalInput, VrcAvatarSelectModalOutput>
  implements OnInit, VrcAvatarSelectModalInput, AfterViewInit
{
  categories: string[] = [];
  avatars: {
    [key: string]: any;
  } = {};
  activeCategory = '';
  results: AvatarEx[] = [];

  constructor(private vrchat: VRChatService, private modalService: ModalService) {
    super();
  }

  async ngOnInit(): Promise<void> {}

  async ngAfterViewInit(): Promise<void> {
    await this.fetchAvatars();
  }

  async fetchAvatars(force = false) {
    this.activeCategory = 'LOADING';
    const currentUser = await firstValueFrom(this.vrchat.user);
    if (!currentUser) {
      this.close();
      return;
    }
    const avatars = await this.vrchat.listAvatars(force);
    this.avatars = {};
    for (const avatar of avatars) {
      if (avatar.favoriteGroup) {
        if (!this.categories.includes(avatar.favoriteGroup)) {
          this.categories.push(avatar.favoriteGroup);
        }
        this.avatars[avatar.favoriteGroup] ??= [];
        this.avatars[avatar.favoriteGroup].push(avatar);
      }
      if (avatar.authorId === currentUser.id) {
        const key = 'comp.vrc-avatar-select-modal.ownAvatars';
        if (!this.categories.includes(key)) {
          this.categories.push(key);
        }
        this.avatars[key] ??= [];
        this.avatars[key].push(avatar);
      }
    }
    if (!this.categories.includes(this.activeCategory) && this.categories.length) {
      this.activeCategory = this.categories[0];
    } else {
      this.activeCategory = 'NO_AVATARS';
    }
    this.results = this.avatars[this.activeCategory] ?? [];
  }

  setActiveCategory(category: string) {
    if (!this.categories.includes(category)) return;
    this.activeCategory = category;
    this.results = this.avatars[this.activeCategory] ?? [];
  }

  refresh() {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'comp.vrc-avatar-select-modal.refreshWarning.title',
        message: 'comp.vrc-avatar-select-modal.refreshWarning.message',
        confirmButtonText: 'shared.modals.refresh',
      })
      .subscribe(async (data) => {
        if (data?.confirmed) await this.fetchAvatars(true);
      });
  }

  selectResult(avatar: AvatarEx | null) {
    this.result = { avatar };
    this.close();
  }
}
