import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable, pairwise, startWith } from 'rxjs';
import { OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';
import { commands } from 'src-ui/app/bindings';
import { OVRDevice } from '../models/ovr-device';
import { error, info } from '@tauri-apps/plugin-log';
import { ExecutableReferenceStatus } from '../models/settings';
import { ToastService } from './toast.service';
import { EventLogFailure } from '../models/event-log-entry';

/** Statuses the Message Centre posts a warning for. */
export const LIGHTHOUSE_CONSOLE_ERROR_STATUSES: ExecutableReferenceStatus[] = [
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'INVALID_FILENAME',
  'UNKNOWN_ERROR',
  'INVALID_EXECUTABLE',
];

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
    private openvr: OpenVRService,
    private toasts: ToastService
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
    const result = await commands.runCommand(path, [
      '/serial',
      'bogus_device_id_that_absolutely_does_not_exist',
      'bogus_command_that_absolutely_does_not_exist',
    ]);
    if (generation !== this.validationGeneration) return;
    if (result.status === 'error') {
      const status = ['NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_FILENAME'].includes(result.error)
        ? (result.error as ExecutableReferenceStatus)
        : 'UNKNOWN_ERROR';
      this._consoleStatus.next(status);
      return;
    }
    const stdoutLines = result.data.stdout.split('\n');
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

  /** Why devices did not turn off: the Message Centre explains a console that is not usable. */
  get powerOffFailure(): EventLogFailure {
    return LIGHTHOUSE_CONSOLE_ERROR_STATUSES.includes(this._consoleStatus.value)
      ? 'SEE_MESSAGE_CENTRE'
      : 'UNKNOWN';
  }

  async turnOffDevices(ovrDevices: OVRDevice[]) {
    return this.queuePowerOff(
      ovrDevices
        .map((device) => device.serialNumber)
        .filter((serialNumber): serialNumber is string => !!serialNumber)
    );
  }

  /** Turns off one device for a user action, and shows a toast when it could not be turned off. */
  async turnOffDeviceForUser(ovrDevice: OVRDevice, deviceName: string) {
    const dispatched = await this.turnOffDevices([ovrDevice]);
    if (!dispatched.length) {
      this.toasts.show({
        type: 'error',
        title: { string: 'toasts.devicePower.turnOffFailed.title', values: { name: deviceName } },
        message:
          this._consoleStatus.value === 'SUCCESS'
            ? 'toasts.devicePower.turnOffFailed.commandFailed'
            : 'toasts.devicePower.turnOffFailed.consoleNotReady',
        duration: 6000,
      });
    }
    return dispatched;
  }

  private queuePowerOff(deviceSerialNumbers: string[]) {
    const batch = this.powerOffQueue.then(() => this.runTurnOffDevices(deviceSerialNumbers));
    this.powerOffQueue = batch.then(
      () => {},
      () => {}
    );
    return batch;
  }

  private async runTurnOffDevices(deviceSerialNumbers: string[]): Promise<OVRDevice[]> {
    const settings = await firstValueFrom(this.appSettings.settings);
    const lighthouseConsolePath = settings.lighthouseConsolePath;
    const generation = this.validationGeneration;
    if (this._consoleStatus.value !== 'SUCCESS' || this.validatedPath !== lighthouseConsolePath)
      return [];
    // resolve requested serials against the current device snapshot
    const requestedSerials = new Set(deviceSerialNumbers);
    const ovrDevices = (await firstValueFrom(this.openvr.devices)).filter(
      (device) =>
        device.powerMethod === 'Lighthouse' &&
        device.serialNumber &&
        requestedSerials.has(device.serialNumber) &&
        device.canPowerOff &&
        device.dongleId &&
        !device.isTurningOff
    );
    // dispatch all devices at once unless the user opted into spacing them out
    if (!settings.lighthousePowerOffDelay) {
      if (generation !== this.validationGeneration) return [];
      const results = await Promise.all(
        ovrDevices.map((device) => this.powerOffDevice(device, lighthouseConsolePath))
      );
      return ovrDevices.filter((_, index) => results[index]);
    }

    // dispatch devices sequentially, since parallel power-offs crash SteamVR for some users
    const dispatched: OVRDevice[] = [];
    for (const [index, device] of ovrDevices.entries()) {
      if (generation !== this.validationGeneration) break;
      if (await this.powerOffDevice(device, lighthouseConsolePath)) dispatched.push(device);
      if (index < ovrDevices.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    return dispatched;
  }

  /** Resolves true when the console exits with status 0. */
  private async powerOffDevice(device: OVRDevice, lighthouseConsolePath: string): Promise<boolean> {
    const dongleId = device.dongleId;
    if (!dongleId) return false;
    this.openvr.setTurningOff(device.index, true);
    info(`[Lighthouse] Turning off device ${device.class}:${device.serialNumber}`);
    const result = await commands.runCommand(lighthouseConsolePath, [
      '/serial',
      dongleId,
      'poweroff',
    ]);
    if (result.status === 'error') {
      error(
        `[Lighthouse] Could not turn off device ${device.class}:${device.serialNumber}: ${result.error}`
      );
      return false;
    }
    if (result.data.status === 0) return true;
    error(
      `[Lighthouse] Power-off command failed for ${device.serialNumber}: exit ${result.data.status}`
    );
    return false;
  }
}
