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
import { commands, OVRFrameLimits } from 'src-ui/app/bindings';
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

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService
  ) {}

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
        await this.applyFrameLimit(appId, null);
        return;
      default:
        if (typeof value !== 'number') throw new Error('Invalid frame limit value');
        this._activeFrameLimits.next({
          ...this._activeFrameLimits.value,
          [appId]: value,
        });
        await this.applyFrameLimit(appId, {
          additionalFramesToPredict: value,
          framesToThrottle: value,
        });
        return;
    }
  }

  /** Rejects with the core's error, which the frame limit automations log as a failure. */
  private async applyFrameLimit(appId: number, limits: OVRFrameLimits | null) {
    const result = await commands.openvrSetAppFramelimit(appId, limits);
    if (result.status === 'error') throw result.error;
  }

  private async getActiveFrameLimitForAppId(appId: number): Promise<FrameLimitConfigOption | null> {
    const status = await firstValueFrom(this.openvr.status);
    if (status !== 'INITIALIZED') return null;
    const result = await commands.openvrGetAppFramelimit(appId);
    if (result.status === 'error') return null;
    if (result.data === null) return 'AUTO';
    return Math.max(result.data.framesToThrottle, result.data.additionalFramesToPredict);
  }
}
