import { ApplicationRef, Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { exit } from '@tauri-apps/api/process';
import { DeviceUpdateEvent } from '../models/events';
import { invoke } from '@tauri-apps/api/tauri';
import { OVRDevice } from '../models/ovr-device';
import {
  BehaviorSubject,
  firstValueFrom,
  interval,
  Observable,
  pairwise,
  startWith,
  Subject,
  takeUntil,
} from 'rxjs';
import { orderBy } from 'lodash';
import { message } from '@tauri-apps/api/dialog';
import { AppSettingsService } from './app-settings.service';

export type LighthouseConsoleStatus =
  | 'UNKNOWN'
  | 'CHECKING'
  | 'NOT_FOUND'
  | 'INVALID_EXECUTABLE'
  | 'PERMISSION_DENIED'
  | 'INVALID_FILENAME'
  | 'UNKNOWN_ERROR'
  | 'SUCCESS';

@Injectable({
  providedIn: 'root',
})
export class OpenVRService {
  private onInitialize$: Subject<void> = new Subject();
  private readonly initStart: number;

  private _devices: BehaviorSubject<OVRDevice[]> = new BehaviorSubject<OVRDevice[]>([]);
  public devices: Observable<OVRDevice[]> = this._devices.asObservable();

  constructor(private appRef: ApplicationRef, private settingsService: AppSettingsService) {
    this.initStart = Date.now();
    this.init();
  }

  async init() {
    interval(2000)
      .pipe(startWith(null), takeUntil(this.onInitialize$))
      .subscribe(async () => {
        const ovrStatus = await invoke('openvr_status');
        switch (ovrStatus) {
          case 'INIT_COMPLETE':
            await this.onOpenVRInit(true);
            break;
          case 'INIT_FAILED':
            await this.onOpenVRInit(false);
            return;
          case 'QUIT':
            await this.onQuitEvent();
            return;
          case 'INITIALIZING':
        }
      });
    await Promise.all([
      listen<DeviceUpdateEvent>('OVR_DEVICE_UPDATE', (event) =>
        this.onDeviceUpdate(event.payload.device)
      ),
      listen<void>('OVR_QUIT', () => this.onQuitEvent()),
      listen<void>('OVR_INIT_COMPLETE', () => {
        this.onOpenVRInit(true);
      }),
      listen<void>('OVR_INIT_FAILED', () => {
        this.onOpenVRInit(false);
      }),
    ]);
  }

  async onOpenVRInit(success: boolean) {
    if (success) {
      this.onInitialize$.next();
      const minSplashDuration = 2000;
      const currentSplashDuration = Date.now() - this.initStart;
      const remainingSplashDuration = Math.max(0, minSplashDuration - currentSplashDuration);
      setTimeout(async () => await invoke('close_splashscreen'), remainingSplashDuration);
      this._devices.next(await this.getDevices());
      interval(3000).subscribe(async () => {
        this._devices.next(await this.getDevices());
      });
    } else {
      await message(
        'Could not connect to SteamVR. Please make sure SteamVR is installed before launching Oyasumi.',
        { type: 'error', title: 'Oyasumi' }
      );
      await exit(0);
    }
  }

  onDeviceUpdate(device: OVRDevice) {
    device = Object.assign({}, device);
    if (!device.canPowerOff) device.isTurningOff = false;
    this._devices.next(
      orderBy(
        [device, ...this._devices.value.filter((d) => d.index !== device.index)],
        ['deviceIndex'],
        ['asc']
      )
    );
    this.appRef.tick();
  }

  async onQuitEvent() {
    await exit(0);
  }

  private getDevices(): Promise<Array<OVRDevice>> {
    return invoke<OVRDevice[]>('openvr_get_devices');
  }
}
