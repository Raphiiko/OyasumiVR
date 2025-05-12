import { Injectable } from '@angular/core';
import { FrameLimitConfigOption } from '../models/automations';
import { AutomationConfigService } from './automation-config.service';
import {
  BehaviorSubject,
  distinctUntilChanged,
  interval,
  map,
  startWith,
  switchMap,
  filter,
  firstValueFrom,
} from 'rxjs';
import { isEqual, omit } from 'lodash';
import { invoke } from '@tauri-apps/api/core';
import { OpenVRService } from './openvr.service';

export interface FrameLimiterAppPreset {
  appLabel: string;
  appId: number;
  appIcon?: string;
}

export const FrameLimiterPresets: FrameLimiterAppPreset[] = [
  {
    appLabel: 'VRChat',
    appId: 438100,
    appIcon: 'assets/img/vrc_icon.png',
  },
  {
    appLabel: 'Resonite',
    appId: 2519830,
    appIcon: 'assets/img/resonite_icon.png',
  },
  {
    appLabel: 'ChilloutVR',
    appId: 661130,
    appIcon: 'assets/img/cvr_icon.png',
  },
];

@Injectable({
  providedIn: 'root',
})
export class FrameLimiterService {
  private readonly _activeFrameLimits = new BehaviorSubject<{
    [appId: number]: FrameLimitConfigOption | null;
  }>({});
  public readonly activeFrameLimits = this._activeFrameLimits.asObservable();

  constructor(private automationConfig: AutomationConfigService, private openvr: OpenVRService) {}

  public async init() {
    this.automationConfig.configs
      .pipe(
        map((configs) => configs.FRAME_LIMIT_AUTOMATIONS),
        map((config) => config.configs.map((c) => c.appId)),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        switchMap((appIds) =>
          interval(1000).pipe(
            startWith(null),
            switchMap(() => this.openvr.status),
            filter((status) => status === 'INITIALIZED'),
            switchMap(() =>
              Promise.all(appIds.map((appId) => this.getActiveFrameLimitForAppId(appId)))
            ),
            map((frameLimits) =>
              frameLimits.reduce(
                (acc, curr, index) => {
                  acc[appIds[index]] = curr;
                  return acc;
                },
                {} as {
                  [appId: number]: FrameLimitConfigOption | null;
                }
              )
            )
          )
        )
      )
      .subscribe((appFrameLimits) => {
        this._activeFrameLimits.next(appFrameLimits);
      });
  }

  public async setFrameLimitForAppId(appId: number, value: FrameLimitConfigOption) {
    const status = await firstValueFrom(this.openvr.status);
    if (status !== 'INITIALIZED') return;
    switch (value) {
      case 'DISABLED':
        return;
      case 'AUTO':
        this._activeFrameLimits.next(
          omit(
            {
              ...this._activeFrameLimits.value,
            },
            appId
          )
        );
        await invoke('openvr_set_app_framelimit', {
          appId,
          limits: null,
        });
        return;
      default:
        if (typeof value !== 'number') throw new Error('Invalid frame limit value');
        this._activeFrameLimits.next({
          ...this._activeFrameLimits.value,
          [appId]: value,
        });
        await invoke('openvr_set_app_framelimit', {
          appId,
          limits: {
            additionalFramesToPredict: value,
            framesToThrottle: value,
          },
        });
        return;
    }
  }

  private async getActiveFrameLimitForAppId(appId: number): Promise<FrameLimitConfigOption | null> {
    const status = await firstValueFrom(this.openvr.status);
    if (status !== 'INITIALIZED') return null;
    try {
      const result = await invoke<{
        additionalFramesToPredict: number;
        framesToThrottle: number;
      } | null>('openvr_get_app_framelimit', {
        appId,
      });
      if (result === null) return 'AUTO';
      return Math.max(result.framesToThrottle, result.additionalFramesToPredict);
    } catch (e) {
      return null;
    }
  }
}
