import { ChangeDetectionStrategy, Component } from '@angular/core';
import { commands } from '../../../../../../bindings';
import { error } from '@tauri-apps/plugin-log';
import { firstValueFrom } from 'rxjs';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { ShowInFolderService } from '../../../../../../services/show-in-folder.service';
import { ToastService } from '../../../../../../services/toast.service';

const MANIFEST_REREGISTER_ERRORS = [
  'MANIFEST_ADD_FAILED',
  'MANIFEST_REMOVE_FAILED',
  'MANIFEST_CHECK_FAILED',
  'MANIFEST_NOT_REGISTERED',
  'FLAVOUR_NOT_ELIGIBLE',
];

@Component({
  selector: 'app-settings-troubleshooting-tools-tab',
  templateUrl: './settings-troubleshooting-tools-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsTroubleshootingToolsTabComponent {
  protected readonly devToolsAvailable = commands.devToolsAvailable();

  constructor(
    protected openvr: OpenVRService,
    private toasts: ToastService,
    private showInFolder: ShowInFolderService
  ) {}

  async openLogsFolder() {
    await this.showInFolder.showLogFile();
  }

  async reregisterVRManifest() {
    if ((await firstValueFrom(this.openvr.status)) !== 'INITIALIZED') return;
    try {
      await commands.openvrReregisterManifest();
    } catch (e) {
      error(`[Troubleshooting] Could not re-register VR manifest: ${JSON.stringify(e)}`);
      const result = MANIFEST_REREGISTER_ERRORS.includes(e as string) ? (e as string) : 'UNKNOWN';
      this.toasts.show({
        type: result === 'FLAVOUR_NOT_ELIGIBLE' ? 'info' : 'error',
        title: `toasts.vrManifestReregister.${result}.title`,
        message: `toasts.vrManifestReregister.${result}.message`,
        duration: 8000,
      });
      return;
    }
    this.toasts.show({
      type: 'success',
      title: 'toasts.vrManifestReregister.success.title',
      message: 'toasts.vrManifestReregister.success.message',
    });
  }

  async openDevTools() {
    await commands.openDevTools();
  }
}
