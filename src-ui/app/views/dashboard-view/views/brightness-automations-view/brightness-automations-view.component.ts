import { Component } from '@angular/core';
import { ModalService } from '../../../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';
import { hshrink } from '../../../../utils/animations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BrightnessAutomationsConfig } from '../../../../models/automations';

@Component({
  selector: 'app-brightness-automations-view',
  templateUrl: './brightness-automations-view.component.html',
  styleUrls: ['./brightness-automations-view.component.scss'],
  animations: [hshrink()],
})
export class BrightnessAutomationsViewComponent {
  activeTab: 'BRIGHTNESS_AUTOMATIONS' | 'HMD_SETTINGS' = 'BRIGHTNESS_AUTOMATIONS';
  advancedMode = false;

  constructor(
    private modalService: ModalService,
    private automationConfigService: AutomationConfigService
  ) {
    this.automationConfigService.configs.pipe(takeUntilDestroyed()).subscribe((configs) => {
      this.advancedMode = configs.BRIGHTNESS_AUTOMATIONS.advancedMode;
    });
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

  async toggleAdvancedMode() {
    await this.automationConfigService.updateAutomationConfig<BrightnessAutomationsConfig>(
      'BRIGHTNESS_AUTOMATIONS',
      { advancedMode: !this.advancedMode }
    );
  }
}
