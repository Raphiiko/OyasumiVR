import { Component } from '@angular/core';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../confirm-modal/confirm-modal.component';
import { BrightnessAutomationsConfig } from '../../models/automations';
import { ModalService } from '../../services/modal.service';
import { AutomationConfigService } from '../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { hshrink } from '../../utils/animations';

@Component({
  selector: 'app-brightness-advanced-mode-toggle',
  templateUrl: './brightness-advanced-mode-toggle.component.html',
  styleUrl: './brightness-advanced-mode-toggle.component.scss',
  animations: [hshrink()],
  standalone: false,
})
export class BrightnessAdvancedModeToggleComponent {
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
