import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, pairwise, startWith } from 'rxjs';
import { OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';
import { invoke } from '@tauri-apps/api/core';
import { OVRDevice } from '../models/ovr-device';
import { error, info } from '@tauri-apps/plugin-log';
import { ExecutableReferenceStatus } from '../models/settings';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class LighthouseConsoleService {
  private _consoleStatus: BehaviorSubject<ExecutableReferenceStatus> =
    new BehaviorSubject<ExecutableReferenceStatus>('UNKNOWN');
  public consoleStatus: Observable<ExecutableReferenceStatus> = this._consoleStatus.asObservable();
  private powerOffQueue: Promise<void> = Promise.resolve();
  private validationGeneration = 0;
  private validatedPath: string | undefined;

  constructor(
    private appSettings: AppSettingsService,
    private openvr: OpenVRService
  ) {
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
      let deviceSerialNumbers: unknown;
      try {
        deviceSerialNumbers = JSON.parse(event.payload);
      } catch {
        return;
      }
      if (
        !Array.isArray(deviceSerialNumbers) ||
        !deviceSerialNumbers.every(
          (serialNumber): serialNumber is string =>
            typeof serialNumber === 'string' && serialNumber.length > 0
        )
      )
        return;
      await this.queuePowerOff(deviceSerialNumbers);
    });
  }

  async setConsolePath(path: string, save = true) {
    if (save) this.appSettings.updateSettings({ lighthouseConsolePath: path });
    const generation = ++this.validationGeneration;
    this.validatedPath = undefined;
    this._consoleStatus.next('CHECKING');
    if (!path.endsWith('lighthouse_console.exe')) {
      this._consoleStatus.next('NOT_FOUND');
      return;
    }
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
      if (generation !== this.validationGeneration) return;
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
    if (generation !== this.validationGeneration) return;
    const stdoutLines = stdout.split('\n');
    if (
      !stdoutLines.length ||
      !stdoutLines[0].trim().startsWith('Version:  lighthouse_console.exe')
    ) {
      this._consoleStatus.next('INVALID_EXECUTABLE');
      return;
    }
    this.validatedPath = path;
    this._consoleStatus.next('SUCCESS');
  }

  async turnOffDevices(ovrDevices: OVRDevice[]) {
    return this.queuePowerOff(
      ovrDevices
        .map((device) => device.serialNumber)
        .filter((serialNumber): serialNumber is string => !!serialNumber)
    );
  }

  private queuePowerOff(deviceSerialNumbers: string[]) {
    const batch = this.powerOffQueue.then(() => this.runTurnOffDevices(deviceSerialNumbers));
    this.powerOffQueue = batch.catch(() => {});
    return batch;
  }

  private async runTurnOffDevices(deviceSerialNumbers: string[]) {
    const settings = await firstValueFrom(this.appSettings.settings);
    const lighthouseConsolePath = settings.lighthouseConsolePath;
    const generation = this.validationGeneration;
    if (this._consoleStatus.value !== 'SUCCESS' || this.validatedPath !== lighthouseConsolePath)
      return;
    // resolve the devices as they are now, not as the caller saw them
    const requestedSerials = new Set(deviceSerialNumbers);
    const ovrDevices = (await firstValueFrom(this.openvr.devices)).filter(
      (device) =>
        device.serialNumber &&
        requestedSerials.has(device.serialNumber) &&
        device.canPowerOff &&
        device.dongleId &&
        !device.isTurningOff
    );
    // sequential on purpose: parallel poweroffs can crash SteamVR
    for (const [index, device] of ovrDevices.entries()) {
      if (generation !== this.validationGeneration) return;
      this.openvr.onDeviceUpdate(Object.assign({}, device, { isTurningOff: true }));
      info(`[Lighthouse] Turning off device ${device.class}:${device.serialNumber}`);
      try {
        await invoke('run_command', {
          command: lighthouseConsolePath,
          args: ['/serial', device.dongleId, 'poweroff'],
        });
      } catch (e) {
        // One unreachable dongle must not stop the devices queued behind it.
        error(
          `[Lighthouse] Could not turn off device ${device.class}:${device.serialNumber}: ${e}`
        );
      }
      if (settings.lighthousePowerOffDelay && index < ovrDevices.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  }
}
