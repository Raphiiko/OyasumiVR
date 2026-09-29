import { invoke } from '@tauri-apps/api/core';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  shareReplay,
} from 'rxjs';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';
import type { OpenVRService } from '../../openvr.service';
import { CctControlDriver } from './cct-control-driver';

/** Headsets that apply the SteamVR display color gains. */
export const STEAMVR_CCT_SUPPORTED_HMDS: { manufacturer: string; model: string }[] = [
  { manufacturer: 'Valve', model: 'Index' },
  { manufacturer: 'Bigscreen', model: 'Beyond' },
];

export function isSteamVrCctSupportedHmd(
  hmd: Pick<OVRDevice, 'manufacturerName' | 'modelNumber'>
): boolean {
  return STEAMVR_CCT_SUPPORTED_HMDS.some(
    (m) => m.manufacturer === hmd.manufacturerName && m.model === hmd.modelNumber
  );
}

/** Writes the SteamVR display color gains, which only some headsets apply. */
export class SteamVrCctControlDriver extends CctControlDriver {
  readonly name = 'SteamVR color gain';
  private readonly matching: Observable<boolean>;

  constructor(
    openvr: Pick<OpenVRService, 'status' | 'devices'>,
    appSettings: Observable<AppSettings>
  ) {
    super();
    const tryUnsupported = appSettings.pipe(
      map((settings) => settings.cctControlOnUnsupportedHmds),
      distinctUntilChanged()
    );
    this.matching = combineLatest([openvr.status, openvr.devices, tryUnsupported]).pipe(
      debounceTime(100),
      map(([status, devices, tryUnsupported]) => {
        const hmd = devices.find((d) => d.index === 0);
        if (status !== 'INITIALIZED' || hmd?.class !== 'HMD') return false;
        return tryUnsupported || isSteamVrCctSupportedHmd(hmd);
      }),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }

  matches(): Observable<boolean> {
    return this.matching;
  }

  isAvailable(): Observable<boolean> {
    return this.matching;
  }

  async setCCT(kelvin: number): Promise<void> {
    invoke('openvr_set_analog_color_temp', { temperature: kelvin });
  }
}
