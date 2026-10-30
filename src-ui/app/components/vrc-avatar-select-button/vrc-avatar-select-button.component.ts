import { ChangeDetectorRef, Component, model } from '@angular/core';
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
  standalone: false,
})
export class VrcAvatarSelectButtonComponent {
  readonly avatar = model<PersistedAvatar | null>(null);

  constructor(
    private modalService: ModalService,
    private cdr: ChangeDetectorRef
  ) {}

  deselect() {
    this.avatar.set(null);
  }

  select() {
    this.modalService
      .addModal<VrcAvatarSelectModalInput, VrcAvatarSelectModalOutput>(
        VrcAvatarSelectModalComponent
      )
      .subscribe((result) => {
        if (result && result.avatar !== undefined) {
          this.avatar.set(
            result.avatar === null
              ? null
              : {
                  name: result.avatar.name,
                  imageUrl: result.avatar.imageUrl,
                  id: result.avatar.id,
                }
          );
        }
        this.cdr.markForCheck();
      });
  }
}
