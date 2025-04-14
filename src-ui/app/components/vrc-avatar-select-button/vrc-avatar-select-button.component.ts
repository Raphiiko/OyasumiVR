import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ModalService } from 'src-ui/app/services/modal.service';
import {
  VrcAvatarSelectModalComponent,
  VrcAvatarSelectModalInput,
  VrcAvatarSelectModalOutput,
} from '../vrc-avatar-select-modal/vrc-avatar-select-modal.component';
import { hshrink, noop } from '../../utils/animations';
import { PersistedAvatar } from '../../models/vrchat';

@Component({
    selector: 'app-vrc-avatar-select-button',
    templateUrl: './vrc-avatar-select-button.component.html',
    styleUrls: ['./vrc-avatar-select-button.component.scss'],
    animations: [noop(), hshrink()],
    standalone: false
})
export class VrcAvatarSelectButtonComponent {
  @Input() avatar: PersistedAvatar | null = null;
  @Output() avatarChange = new EventEmitter<PersistedAvatar | null>();

  constructor(private modalService: ModalService) {}

  deselect() {
    this.avatar = null;
    this.avatarChange.emit(null);
  }

  select() {
    this.modalService
      .addModal<VrcAvatarSelectModalInput, VrcAvatarSelectModalOutput>(
        VrcAvatarSelectModalComponent
      )
      .subscribe((result) => {
        if (result && result.avatar !== undefined) {
          this.avatar =
            result.avatar === null
              ? null
              : {
                  name: result.avatar.name,
                  imageUrl: result.avatar.imageUrl,
                  id: result.avatar.id,
                };
          this.avatarChange.emit(this.avatar);
        }
      });
  }
}
