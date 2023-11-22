import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { AudioDevice, AudioDeviceParsedName, AudioDeviceType } from '../models/audio-device';
import { BehaviorSubject } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { clamp } from '../utils/number-utils';

const PERSISTENT_ID_LEAD = 'AUDIO_DEVICE_[';
const PERSISTENT_ID_TRAIL = ']';

@Injectable({
  providedIn: 'root',
})
export class AudioDeviceService {
  private readonly _activeDevices = new BehaviorSubject<AudioDevice[]>([]);
  public readonly activeDevices = this._activeDevices.asObservable();

  constructor() {}

  async init() {
    await this.getAudioDevices();
    await listen<AudioDevice>('audioDeviceUpdated', (event) => {
      const devices = this._activeDevices.value;
      // Replace the relevant device
      const index = devices.findIndex((d) => d.id === event.payload.id);
      if (index !== -1) {
        this.hydrateAudioDevice(event.payload);
        devices[index] = event.payload;
      } else {
        devices.push(event.payload);
      }
      this._activeDevices.next(devices);
    });
    await listen<AudioDevice[]>('audioDevicesUpdated', (event) => {
      event.payload.forEach((d) => this.hydrateAudioDevice(d));
      this._activeDevices.next(event.payload);
    });
  }

  async getAudioDevices(refresh = false) {
    const devices = await invoke<AudioDevice[]>('get_audio_devices', { refresh });
    devices.forEach((d) => this.hydrateAudioDevice(d));
    this._activeDevices.next(devices);
  }

  async setVolume(deviceId: string, volume: number) {
    if (!this.isActiveDevice(deviceId)) return;
    volume = clamp(volume, 0, 1);
    this.patchDevice(deviceId, { volume });
    await invoke('set_audio_device_volume', { deviceId, volume });
  }

  async setMute(
    deviceId: string,
    mute: boolean
  ): Promise<{
    muted: boolean;
    device: AudioDevice;
  } | null> {
    const device = this._activeDevices.value.find((d) => d.id === deviceId);
    if (!device) return null;
    this.patchDevice(deviceId, { mute });
    await invoke('set_audio_device_mute', { deviceId, mute });
    return { muted: mute, device };
  }

  isActiveDevice(deviceId: string) {
    return this._activeDevices.value.some((d) => d.id === deviceId);
  }

  private patchDevice(deviceId: string, patch: Partial<AudioDevice>) {
    const devices = this._activeDevices.value;
    const index = devices.findIndex((d) => d.id === deviceId);
    if (index !== -1) {
      devices[index] = { ...devices[index], ...patch };
      this._activeDevices.next(devices);
    }
  }

  public getAudioDeviceNameForPersistentId(id: string): AudioDeviceParsedName | null {
    const devices = this._activeDevices.value;
    if (id === 'DEFAULT_CAPTURE')
      return devices.find((d) => d.default && d.deviceType === 'Capture')?.parsedName ?? null;
    if (id === 'DEFAULT_RENDER')
      return devices.find((d) => d.default && d.deviceType === 'Render')?.parsedName ?? null;
    if (!id.startsWith(PERSISTENT_ID_LEAD) || !id.endsWith(PERSISTENT_ID_TRAIL)) return null;
    return this.getAudioDeviceParsedNameForDeviceName(
      id.substring(PERSISTENT_ID_LEAD.length, id.length - PERSISTENT_ID_TRAIL.length)
    );
  }

  public getAudioDeviceForPersistentId(id?: string | null): AudioDevice | null {
    if (!id) return null;
    const devices = this._activeDevices.value;
    if (id === 'DEFAULT_CAPTURE')
      return devices.find((d) => d.default && d.deviceType === 'Capture') ?? null;
    if (id === 'DEFAULT_RENDER')
      return devices.find((d) => d.default && d.deviceType === 'Render') ?? null;
    if (!id.startsWith(PERSISTENT_ID_LEAD) || !id.endsWith(PERSISTENT_ID_TRAIL)) return null;
    const name = id.substring(PERSISTENT_ID_LEAD.length, id.length - PERSISTENT_ID_TRAIL.length);
    return devices.find((d) => d.name === name) ?? null;
  }

  private getAudioDeviceParsedNameForDeviceName(deviceName: string): AudioDeviceParsedName {
    const splitIndex = deviceName.indexOf('(');
    if (splitIndex === -1) return { display: deviceName, driver: '' };
    const display = deviceName.substring(0, splitIndex).trim();
    const driver = deviceName.substring(splitIndex + 1, deviceName.length - 1).trim();
    return { display, driver };
  }

  private getPersistentIdForAudioDevice(device: AudioDevice): string {
    return PERSISTENT_ID_LEAD + device.name + PERSISTENT_ID_TRAIL;
  }

  private hydrateAudioDevice(device: AudioDevice) {
    device.persistentId = this.getPersistentIdForAudioDevice(device);
    device.parsedName = this.getAudioDeviceParsedNameForDeviceName(device.name);
    return device;
  }
}
