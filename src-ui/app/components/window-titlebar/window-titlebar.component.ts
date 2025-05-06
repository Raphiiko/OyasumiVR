import { Component, OnInit } from '@angular/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getVersion } from '../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from '../../../build';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { fade } from 'src-ui/app/utils/animations';

const appWindow = getCurrentWebviewWindow();

@Component({
  selector: 'app-window-titlebar',
  templateUrl: './window-titlebar.component.html',
  styleUrls: ['./window-titlebar.component.scss'],
  standalone: false,
  animations: [fade()],
})
export class WindowTitlebarComponent implements OnInit {
  version = '0.0.0';
  showVersionExtras = false;

  constructor(protected messageCenter: MessageCenterService) {

  }

  async ngOnInit() {
    this.version = await getVersion();
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

  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;
}
