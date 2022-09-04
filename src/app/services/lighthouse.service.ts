import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, pairwise, startWith } from 'rxjs';
import { LighthouseConsoleStatus, OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';
import { invoke } from '@tauri-apps/api/tauri';
import { OVRDevice } from '../models/ovr-device';

@Injectable({
  providedIn: 'root',
})
export class LighthouseService {
  private _consoleStatus: BehaviorSubject<LighthouseConsoleStatus> =
    new BehaviorSubject<LighthouseConsoleStatus>('UNKNOWN');
  public consoleStatus: Observable<LighthouseConsoleStatus> =
    this._consoleStatus.asObservable();

  constructor(private appSettings: AppSettingsService, private openvr: OpenVRService) {
    this.init();
  }

  async init() {
    this.appSettings.settings
      .pipe(startWith(await firstValueFrom(this.appSettings.settings)), pairwise())
      .subscribe(([previousSettings, currentSettings]) => {
        if (
          this._consoleStatus.value === 'UNKNOWN' ||
          previousSettings.lighthouseConsolePath !== currentSettings.lighthouseConsolePath
        ) {
          this.setConsolePath(currentSettings.lighthouseConsolePath, false);
        }
      });
  }

  async setConsolePath(path: string, save: boolean = true) {
    if (save) this.appSettings.updateSettings({ lighthouseConsolePath: path });
    this._consoleStatus.next('CHECKING');
    if (!path.endsWith('lighthouse_console.exe')) {
      this._consoleStatus.next('NOT_FOUND');
      return;
    }
    // Get output
    let stdout;
    try {
      stdout = (
        await invoke<{ stdout: string; stderr: string; status: number }>('run_command', {
          command: path,
          args: ['bogus_command'],
        })
      ).stdout;
    } catch (e) {
      if (
        typeof e === 'string' &&
        ['NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_FILENAME'].includes(e)
      ) {
        this._consoleStatus.next(e as LighthouseConsoleStatus);
        return;
      }
      this._consoleStatus.next('UNKNOWN_ERROR');
      return;
    }
    // Check output
    const stdoutLines = stdout.split('\n');
    if (
      !stdoutLines.length ||
      !stdoutLines[0].trim().startsWith('Version:  lighthouse_console.exe')
    ) {
      this._consoleStatus.next('INVALID_EXECUTABLE');
    }
    this._consoleStatus.next('SUCCESS');
  }

  async turnOffDevices(ovrDevices: OVRDevice[]) {
    const lighthouseConsolePath = await firstValueFrom(this.appSettings.settings).then(
      (settings) => settings.lighthouseConsolePath
    );
    if (this._consoleStatus.value !== 'SUCCESS') return;
    ovrDevices = ovrDevices.filter(
      (device) => device.canPowerOff && device.dongleId && !device.isTurningOff
    );
    await Promise.all(
      ovrDevices.map(async (device) => {
        this.openvr.onDeviceUpdate(Object.assign({}, device, { isTurningOff: true }));
        console.log('Turning off device', device);
        await invoke('run_command', {
          command: lighthouseConsolePath,
          args: ['/serial', device.dongleId, 'poweroff'],
        });
      })
    );
  }
}
