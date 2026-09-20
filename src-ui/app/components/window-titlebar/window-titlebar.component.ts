import {
  ChangeDetectorRef,
  Component,
  OnInit,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getVersion } from '../../utils/app-utils';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { BUILD_ID, FLAVOUR } from '../../../build';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { fade } from 'src-ui/app/utils/animations';

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
  showVersionExtras = false;
  protected versionCopied = signal(false);
  private versionCopiedTimer?: ReturnType<typeof setTimeout>;

  constructor(
    protected messageCenter: MessageCenterService,
    private cdr: ChangeDetectorRef
  ) {}

  async ngOnInit() {
    this.version = await getVersion();
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
    await writeText(`v${this.version}-${FLAVOUR} (${BUILD_ID})`);
    this.versionCopied.set(true);
    if (this.versionCopiedTimer) clearTimeout(this.versionCopiedTimer);
    this.versionCopiedTimer = setTimeout(() => {
      this.versionCopied.set(false);
    }, 1000);
  }

  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;
}
