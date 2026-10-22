import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { OVRDevice } from '../models/ovr-device';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { OpenVRService } from './openvr.service';
import { SteamFramePairingService } from './steam-frame/steam-frame-pairing.service';

/** Device actions for callers, routed by each device's `powerMethod`. */
@Injectable({
  providedIn: 'root',
})
export class DeviceControlService {
  constructor(
    private lighthouseConsole: LighthouseConsoleService,
    private steamFrame: SteamFramePairingService,
    private openvr: OpenVRService
  ) {
    void listen<string>('turnOffOVRDevices', (event) => this.onOverlayTurnOff(event.payload));
  }

  /** Turns off the devices the overlay asks for, by serial. */
  private async onOverlayTurnOff(payload: string) {
    let serials: unknown;
    try {
      serials = JSON.parse(payload);
    } catch {
      return;
    }
    if (
      !Array.isArray(serials) ||
      !serials.every((serial): serial is string => typeof serial === 'string' && serial.length > 0)
    )
      return;
    const devices = (await firstValueFrom(this.openvr.devices)).filter(
      (device) => device.serialNumber && serials.includes(device.serialNumber)
    );
    await this.turnOffDevices(devices);
  }

  /** Resolves the devices a turn-off request was sent to. */
  async turnOffDevices(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    const [frameDispatched, consoleDispatched] = await Promise.all([
      this.steamFrame.turnOffDevices(ovrDevices),
      this.lighthouseConsole.turnOffDevices(ovrDevices),
    ]);
    return [...frameDispatched, ...consoleDispatched];
  }

  /** Turns off one device for a user action, and shows a toast when it could not be turned off. */
  async turnOffDeviceForUser(ovrDevice: OVRDevice, deviceName: string): Promise<OVRDevice[]> {
    switch (ovrDevice.powerMethod) {
      case 'Lighthouse':
        return this.lighthouseConsole.turnOffDeviceForUser(ovrDevice, deviceName);
      case 'SteamFrame':
        return this.steamFrame.turnOffDeviceForUser(ovrDevice, deviceName);
      case 'None':
        return [];
    }
  }
}
