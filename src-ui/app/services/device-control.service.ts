import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { info } from '@tauri-apps/plugin-log';
import { listen } from '@tauri-apps/api/event';
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
      this.turnOffFrameControllers(ovrDevices),
      this.lighthouseConsole.turnOffDevices(
        ovrDevices.filter((d) => d.powerMethod === 'Lighthouse')
      ),
    ]);
    return [...frameDispatched, ...consoleDispatched];
  }

  /** Turns off one device for a user action, and shows a toast when it could not be turned off. */
  async turnOffDeviceForUser(ovrDevice: OVRDevice, deviceName: string): Promise<OVRDevice[]> {
    switch (ovrDevice.powerMethod) {
      case 'Lighthouse':
        return this.lighthouseConsole.turnOffDeviceForUser(ovrDevice, deviceName);
      case 'SteamFrame':
        return this.turnOffFrameControllerForUser(ovrDevice, deviceName);
      case 'None':
        return [];
    }
  }

  private async turnOffFrameControllerForUser(
    ovrDevice: OVRDevice,
    deviceName: string
  ): Promise<OVRDevice[]> {
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

  /** Turns off the Frame controllers among these devices, and ignores the rest. */
  private async turnOffFrameControllers(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    if (!ovrDevices.some((device) => device.powerMethod === 'SteamFrame')) return [];

    // resolve requested serials against the current device snapshot
    const requestedSerials = new Set(ovrDevices.map((device) => device.serialNumber));
    const controllers = (await firstValueFrom(this.openvr.devices)).filter(
      (device) =>
        device.powerMethod === 'SteamFrame' &&
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

  /** Resolves true when the helper sent the disconnect. The device stays busy until it reports off. */
  private async turnOffFrameController(device: OVRDevice): Promise<boolean> {
    if (device.powerMethod !== 'SteamFrame' || !device.serialNumber) return false;
    this.openvr.setTurningOff(device.index, true);
    info(`[SteamFrame] Turning off device ${device.class}:${device.serialNumber}`);
    if (await this.steamFrame.disconnectController(device.serialNumber)) return true;
    this.openvr.setTurningOff(device.index, false);
    return false;
  }
}
