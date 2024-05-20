import { Component, OnInit } from '@angular/core';
import { appWindow } from '@tauri-apps/api/window';
import { getVersion } from '../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from '../../../build';

@Component({
  selector: 'app-window-titlebar',
  templateUrl: './window-titlebar.component.html',
  styleUrls: ['./window-titlebar.component.scss'],
})
export class WindowTitlebarComponent implements OnInit {
  version: string = '0.0.0';
  showVersionExtras = false;

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
