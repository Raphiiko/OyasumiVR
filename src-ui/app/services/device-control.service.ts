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
  /** Serials of the Frame controllers whose disconnect is on its way to the helper. */
  private frameTurnOffs = new Set<string>();

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
    await this.turnOffSerials(serials);
  }

  /** Resolves the devices a turn-off request was sent to. */
  async turnOffDevices(ovrDevices: OVRDevice[]): Promise<OVRDevice[]> {
    return this.turnOffSerials(ovrDevices.map((device) => device.serialNumber));
  }

  private async turnOffSerials(serials: (string | undefined)[]): Promise<OVRDevice[]> {
    // look up the current devices, since a caller can hold a copy from before the helper reported
    const devices = (await firstValueFrom(this.openvr.devices)).filter(
      (device) => device.serialNumber && serials.includes(device.serialNumber)
    );
    const [frameDispatched, consoleDispatched] = await Promise.all([
      this.turnOffFrameControllers(devices),
      this.lighthouseConsole.turnOffDevices(devices),
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
    // a press while the first disconnect is on its way is no failure
    if (this.frameTurnOffs.has(ovrDevice.serialNumber ?? '')) return [];
    const dispatched = await this.turnOffDevices([ovrDevice]);
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
    const controllers = ovrDevices.filter((device) => device.powerMethod === 'SteamFrame');
    const results = await Promise.all(
      controllers.map((device) => this.turnOffFrameController(device))
    );
    return controllers.filter((_, index) => results[index]);
  }

  /** Resolves true when the helper sent the disconnect. The device then stays busy until off. */
  private async turnOffFrameController(device: OVRDevice): Promise<boolean> {
    const serial = device.serialNumber;
    if (
      device.powerMethod !== 'SteamFrame' ||
      !serial ||
      !device.canPowerOff ||
      device.isTurningOff ||
      this.frameTurnOffs.has(serial)
    )
      return false;
    this.frameTurnOffs.add(serial);
    info(`[SteamFrame] Turning off device ${device.class}:${serial}`);
    try {
      if (!(await this.steamFrame.disconnectController(serial))) return false;
    } finally {
      this.frameTurnOffs.delete(serial);
    }
    // busy only once sent: busy clearing on a connected device reads as it powering on
    this.openvr.setTurningOff(device.index, true);
    return true;
  }
}
