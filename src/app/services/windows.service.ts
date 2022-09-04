import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/tauri';

@Injectable({
  providedIn: 'root',
})
export class WindowsService {
  constructor() {}

  public async isElevated(): Promise<boolean> {
    return invoke<boolean>('windows_is_elevated');
  }

  relaunchWithElevation() {
    return invoke<boolean>('windows_relaunch_with_elevation');
  }
}
