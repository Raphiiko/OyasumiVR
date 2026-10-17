import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { info } from '@tauri-apps/plugin-log';
import { OVRDevice } from '../models/ovr-device';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { OpenVRService } from './openvr.service';
import { SteamFramePairingService } from './steam-frame/steam-frame-pairing.service';
import { ToastService } from './toast.service';

/** Device actions for callers, routed by each device's `powerMethod`. */
@Injectable({
  providedIn: 'root',
})
export class DeviceControlService {
  constructor(
    private lighthouseConsole: LighthouseConsoleService,
    private steamFrame: SteamFramePairingService,
    private openvr: OpenVRService,
    private toasts: ToastService
  ) {}

  /** Resolves the devices a turn-off request was sent to. */
  async turnOffDevices(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    const [frameDispatched, consoleDispatched] = await Promise.all([
      this.turnOffFrameControllers(ovrDevices.filter((d) => d.powerMethod === 'SteamFrame')),
      this.lighthouseConsole.turnOffDevices(
        ovrDevices.filter((d) => d.powerMethod === 'Lighthouse')
      ),
    ]);
    return [...frameDispatched, ...consoleDispatched];
  }

  /** Turns off one device for a user action, and shows a toast when it could not be turned off. */
  async turnOffDeviceForUser(ovrDevice: OVRDevice, deviceName: string): Promise<OVRDevice[]> {
    if (ovrDevice.powerMethod !== 'SteamFrame')
      return this.lighthouseConsole.turnOffDeviceForUser(ovrDevice, deviceName);

    const dispatched = await this.turnOffFrameControllers([ovrDevice]);
    if (!dispatched.length) {
      this.toasts.show({
        type: 'error',
        title: { string: 'toasts.devicePower.turnOffFailed.title', values: { name: deviceName } },
        message: 'toasts.devicePower.turnOffFailed.frameHelperFailed',
        duration: 6000,
      });
    }
    return dispatched;
  }

  private async turnOffFrameControllers(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    if (!ovrDevices.length) return [];

    // resolve requested serials against the current device snapshot
    const requestedSerials = new Set(ovrDevices.map((device) => device.serialNumber));
    const controllers = (await firstValueFrom(this.openvr.devices)).filter(
      (device) =>
        device.serialNumber &&
        requestedSerials.has(device.serialNumber) &&
        device.canPowerOff &&
        !device.isTurningOff
    );

    const results = await Promise.all(
      controllers.map((device) => this.turnOffFrameController(device))
    );
    return controllers.filter((_, index) => results[index]);
  }

  /** Resolves true when the helper sent the disconnect. The device stays busy until OpenVR reports it off. */
  private async turnOffFrameController(device: OVRDevice): Promise<boolean> {
    this.openvr.onDeviceUpdate(Object.assign({}, device, { isTurningOff: true }));
    info(`[SteamFrame] Turning off device ${device.class}:${device.serialNumber}`);
    if (await this.steamFrame.disconnectController(device.serialNumber!)) return true;
    this.openvr.onDeviceUpdate(Object.assign({}, device, { isTurningOff: false }));
    return false;
  }
}
