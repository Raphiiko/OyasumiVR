import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, pairwise, startWith } from 'rxjs';
import { OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';
import { invoke } from '@tauri-apps/api/core';
import { OVRDevice } from '../models/ovr-device';
import { info } from 'tauri-plugin-log-api';
import { ExecutableReferenceStatus } from '../models/settings';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class LighthouseConsoleService {
  private _consoleStatus: BehaviorSubject<ExecutableReferenceStatus> =
    new BehaviorSubject<ExecutableReferenceStatus>('UNKNOWN');
  public consoleStatus: Observable<ExecutableReferenceStatus> = this._consoleStatus.asObservable();

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
    await listen<string>('turnOffOVRDevices', async (event) => {
      let deviceIndices: number[];
      try {
        deviceIndices = JSON.parse(event.payload);
      } catch (e) {
        return;
      }
      const devices = (await firstValueFrom(this.openvr.devices)).filter((d) =>
        deviceIndices.includes(d.index)
      );
      await this.turnOffDevices(devices);
    });
  }

  async setConsolePath(path: string, save = true) {
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
          args: [
            '/serial',
            'bogus_device_id_that_absolutely_does_not_exist',
            'bogus_command_that_absolutely_does_not_exist',
          ],
        })
      ).stdout;
    } catch (e) {
      if (
        typeof e === 'string' &&
        ['NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_FILENAME'].includes(e)
      ) {
        this._consoleStatus.next(e as ExecutableReferenceStatus);
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
        info(`[Lighthouse] Turning off device ${device.class}:${device.serialNumber}`);
        await invoke('run_command', {
          command: lighthouseConsolePath,
          args: ['/serial', device.dongleId, 'poweroff'],
        });
      })
    );
  }
}
