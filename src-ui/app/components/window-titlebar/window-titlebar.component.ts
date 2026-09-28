import { ChangeDetectorRef, Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getVersion } from '../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from '../../../build';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { fade } from 'src-ui/app/utils/animations';
import { ToastService } from 'src-ui/app/services/toast.service';
import { copyWithToast } from 'src-ui/app/utils/clipboard-utils';

const appWindow = getCurrentWebviewWindow();

@Component({
  selector: 'app-window-titlebar',
  templateUrl: './window-titlebar.component.html',
  styleUrls: ['./window-titlebar.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [fade()],
})
export class WindowTitlebarComponent implements OnInit {
  version = '0.0.0';
  protected versionReady = false;
  showVersionExtras = false;

  constructor(
    protected messageCenter: MessageCenterService,
    private cdr: ChangeDetectorRef,
    private toasts: ToastService
  ) {}

  async ngOnInit() {
    this.version = await getVersion();
    this.versionReady = true;
    this.cdr.markForCheck();
  }

  async minimize() {
    await appWindow.minimize();
  }

  async maximize() {
    await appWindow.toggleMaximize();
  }

  async close() {
    await appWindow.close();
  }

  protected async copyVersion() {
    const version = `v${this.version}-${FLAVOUR} (${BUILD_ID})`;
    await copyWithToast(this.toasts, version, version);
  }

  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;
}
