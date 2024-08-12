import { Component, OnInit } from '@angular/core';
import { appWindow } from '@tauri-apps/api/window';
import { getVersion } from '../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from '../../../build';
import { invoke } from '@tauri-apps/api';

@Component({
  selector: 'app-window-titlebar',
  templateUrl: './window-titlebar.component.html',
  styleUrls: ['./window-titlebar.component.scss'],
})
export class WindowTitlebarComponent implements OnInit {
  version = '0.0.0';
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
    // In Tauri V1, the appWindow.close() call does not get intercepted by the window close event handler.
    // This will be changed in Tauri V2, in which this workaround will no longer be necessary: https://github.com/tauri-apps/tauri/issues/5288
    await invoke('request_app_window_close');
  }

  protected readonly FLAVOUR = FLAVOUR;
  protected readonly BUILD_ID = BUILD_ID;
}
