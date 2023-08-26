import { Component } from '@angular/core';
import { ModalService } from '../../../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-brightness-automations-view',
  templateUrl: './brightness-automations-view.component.html',
  styleUrls: ['./brightness-automations-view.component.scss'],
})
export class BrightnessAutomationsViewComponent {
  activeTab: 'BRIGHTNESS_AUTOMATIONS' = 'BRIGHTNESS_AUTOMATIONS';

  constructor(private modalService: ModalService) {
    this.showModeInfoModal();
  }

  showModeInfoModal() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'brightness-automations.modeInfoModal.title',
        message: 'brightness-automations.modeInfoModal.message',
        confirmButtonText: 'shared.modals.ok',
        showCancel: false,
      })
      .subscribe();
  }
}
