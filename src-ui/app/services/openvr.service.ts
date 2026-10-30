import { ApplicationRef, Injectable } from '@angular/core';
import { commands, events, type OpenVRStatus } from 'src-ui/app/bindings';
import { fromCoreDevice, OVRDevice } from '../models/ovr-device';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  interval,
  map,
  Observable,
  skip,
  startWith,
  Subject,
} from 'rxjs';
import { orderBy } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { TelemetryService } from './telemetry/telemetry.service';

export type { OpenVRStatus };

@Injectable({
  providedIn: 'root',
})
export class OpenVRService {
  private _status: BehaviorSubject<OpenVRStatus> = new BehaviorSubject<OpenVRStatus>('INACTIVE');
  public status: Observable<OpenVRStatus> = this._status.asObservable();
  private _devices: BehaviorSubject<OVRDevice[]> = new BehaviorSubject<OVRDevice[]>([]);
  /** The devices OpenVR reports, with the overrides applied. */
  public devices: Observable<OVRDevice[]> = this._devices.asObservable();
  /** The devices as OpenVR reports them, with the turn-off state OyasumiVR tracks. */
  private reportedDevices: OVRDevice[] = [];
  /** Field values that replace what OpenVR reports, by serial number. */
  private overrides: Record<string, Partial<OVRDevice>> = {};

  private powerControlledSerials = new Set<string>();

  private _analogGainUpdates = new Subject<number>();
  /** SteamVR's analog gain after a change that OyasumiVR did not make itself. */
  public analogGainUpdates: Observable<number> = this._analogGainUpdates.asObservable();

  private autoLaunchQueue: Promise<void> = Promise.resolve();
  private autoLaunchSession = 0;

  constructor(
    private appRef: ApplicationRef,
    private appSettings: AppSettingsService,
    private telemetry: TelemetryService
  ) {}

  async init() {
    let statusReceived = false;
    let deviceSession = 0;
    this._status.next(await commands.openvrStatus());
    this.appSettings.settings
      .pipe(
        map((settings) => settings.openVrInitDelayFix),
        startWith(false),
        distinctUntilChanged(),
        skip(1)
      )
      .subscribe((fixEnabled) => {
        this.applyOpenVrInitDelayFix(fixEnabled);
        if (fixEnabled) info('[OpenVR] Applying OpenVR Initialization delay fix');
        else info('[OpenVR] Removing OpenVR initialization delay fix');
      });
    await Promise.all([
      events.ovrDeviceUpdateEvent.listen((event) =>
        this.onDeviceUpdate(fromCoreDevice(event.payload.device))
      ),
      events.ovrStatusUpdateEvent.listen((event) => {
        statusReceived = true;
        deviceSession++;
        this.onStatusUpdate(event.payload);
      }),
      events.ovrAnalogGainUpdateEvent.listen((event) =>
        this._analogGainUpdates.next(event.payload)
      ),
    ]);
    // A status update sent while the listener above was still being registered is never delivered
    const status = await commands.openvrStatus();
    if (!statusReceived) this.onStatusUpdate(status);
    interval(2000).subscribe(() => this.syncAutoLaunch());

    // restore cached devices missed before listener registration
    const snapshotSession = deviceSession;
    const devices = (await commands.openvrGetDevices()).map(fromCoreDevice);
    if (snapshotSession === deviceSession && this._status.value === 'INITIALIZED') {
      for (const device of devices) {
        if (!this.reportedDevices.some((current) => current.index === device.index)) {
          this.onDeviceUpdate(device);
        }
      }
    }

    this.handleTelemetry();
  }

  public onDeviceUpdate(device: OVRDevice) {
    device = Object.assign({}, device);
    if (device.isTurningOff === null || device.isTurningOff === undefined)
      device.isTurningOff =
        this.reportedDevices.find((d) => d.index === device.index)?.isTurningOff ?? false;
    this.reportedDevices = orderBy(
      [device, ...this.reportedDevices.filter((d) => d.index !== device.index)],
      ['index'],
      ['asc']
    );
    this.publishDevices();
  }

  /** Marks the device busy while a turn-off runs. It clears by itself once the device disconnects. */
  public setTurningOff(index: number, isTurningOff: boolean) {
    const device = this.reportedDevices.find((d) => d.index === index);
    if (!device) return;
    device.isTurningOff = isTurningOff;
    this.publishDevices();
  }

  /** Replaces every override. A device without one shows what OpenVR reports. */
  // ponytail: one caller sets every override; key them by source once a second caller appears
  public setOverrides(overrides: Record<string, Partial<OVRDevice>>) {
    this.overrides = overrides;
    this.publishDevices();
  }

  private publishDevices() {
    const devices = this.reportedDevices.map((reported) => {
      const device = { ...reported, ...this.overrides[reported.serialNumber ?? ''] };
      if (!device.isConnected) reported.isTurningOff = device.isTurningOff = false;
      if (device.canPowerOff && device.serialNumber)
        this.powerControlledSerials.add(device.serialNumber);
      return device;
    });
    this._devices.next(devices);
    this.appRef.tick();
  }

  /** Whether OyasumiVR could turn this device off at any point since the app started. */
  public hasHadPowerControl(device: OVRDevice): boolean {
    return !!device.serialNumber && this.powerControlledSerials.has(device.serialNumber);
  }

  /** Logs a failure instead of rejecting, as SteamVR or the headset can go away mid-transition. */
  public async setAnalogGain(analogGain: number): Promise<void> {
    if (typeof analogGain === 'number' && isFinite(analogGain)) {
      const result = await commands.openvrSetAnalogGain(analogGain);
      if (result.status === 'error') warn(`[OpenVR] Could not set analog gain: ${result.error}`);
    } else {
      console.error('[OpenVR] Attempted to set analogGain to invalid value', analogGain);
      error('[OpenVR] Attempted to set analogGain to invalid value: ' + analogGain);
    }
  }

  public getAnalogGain() {
    return commands.openvrGetAnalogGain();
  }

  public setSupersampleScale(supersampleScale: number | null) {
    return commands.openvrSetSupersampleScale(supersampleScale);
  }

  public setFadeDistance(fadeDistance: number) {
    return commands.openvrSetFadeDistance(fadeDistance);
  }

  public setStartWithSteamVR(enabled: boolean): Promise<void> {
    this.appSettings.updateSettings({
      startWithSteamVR: enabled,
      startWithSteamVRPending: true,
    });
    return this.syncAutoLaunch();
  }

  public async isDashboardVisible(): Promise<boolean> {
    return commands.openvrIsDashboardVisible();
  }

  private onStatusUpdate(status: OpenVRStatus) {
    this.autoLaunchSession++;
    this._status.next(status);
    switch (status) {
      case 'INACTIVE':
      case 'INITIALIZING':
        this.reportedDevices = [];
        this._devices.next([]);
        break;
      case 'INITIALIZED':
        this.syncAutoLaunch();
        break;
    }
  }

  private syncAutoLaunch(): Promise<void> {
    if (this._status.value !== 'INITIALIZED') return Promise.resolve();
    const session = this.autoLaunchSession;
    const run = async () => {
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      if (!this.appSettings.settingsSync.startWithSteamVRPending) {
        const result = await commands.openvrGetApplicationAutoLaunch();
        if (result.status === 'error') {
          error(`[OpenVR] Could not read application auto-launch: ${result.error}`);
          return;
        }
        const enabled = result.data;
        if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
        if (
          !this.appSettings.settingsSync.startWithSteamVRPending &&
          enabled !== this.appSettings.settingsSync.startWithSteamVR
        ) {
          this.appSettings.updateSettings({ startWithSteamVR: enabled });
        }
        return;
      }
      const enabled = this.appSettings.settingsSync.startWithSteamVR;
      const failure = await this.writeAutoLaunch(enabled);
      if (failure) {
        error(`[OpenVR] Could not set application auto-launch: ${failure}`);
        return;
      }
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      if (this.appSettings.settingsSync.startWithSteamVR === enabled) {
        this.appSettings.updateSettings({ startWithSteamVRPending: false });
      }
    };
    this.autoLaunchQueue = this.autoLaunchQueue.then(run, run);
    return this.autoLaunchQueue;
  }

  /** Resolves the failure reason, or null once SteamVR reads back the written setting. */
  private async writeAutoLaunch(enabled: boolean): Promise<string | null> {
    const written = await commands.openvrSetApplicationAutoLaunch(enabled);
    if (written.status === 'error') return written.error;
    const confirmed = await commands.openvrGetApplicationAutoLaunch();
    if (confirmed.status === 'error') return confirmed.error;
    return confirmed.data === enabled ? null : 'AUTO_LAUNCH_WRITE_NOT_CONFIRMED';
  }

  private async applyOpenVrInitDelayFix(enabled: boolean) {
    await commands.openvrSetInitDelayFix(enabled);
  }

  private handleTelemetry() {
    this._devices
      .pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')),
        filter(Boolean),
        distinctUntilChanged()
      )
      .subscribe((hmdName) => {
        this.telemetry.trackThrottledEvent(
          'vr_hmd',
          {
            manufacturerName: hmdName.manufacturerName ?? 'Unknown',
            modelNumber: hmdName.modelNumber ?? 'Unknown',
            hmdName: `${hmdName.manufacturerName} ${hmdName.modelNumber}`,
          },
          1000 * 60 * 60 * 24,
          true
        );
      });
  }
}
