import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { AudioDevice } from '../models/audio-device';
import { BehaviorSubject } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { clamp } from '../utils/number-utils';

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
        devices[index] = event.payload;
      } else {
        devices.push(event.payload);
      }
      this._activeDevices.next(devices);
    });
    await listen<AudioDevice[]>('audioDevicesUpdated', (event) => {
      this._activeDevices.next(event.payload);
    });
  }

  async getAudioDevices(refresh = false) {
    const devices = await invoke<AudioDevice[]>('get_audio_devices', { refresh });
    this._activeDevices.next(devices);
  }

  async setVolume(deviceId: string, volume: number) {
    if (!this.isActiveDevice(deviceId)) return;
    volume = clamp(volume, 0, 1);
    this.patchDevice(deviceId, { volume });
    await invoke('set_audio_device_volume', { deviceId, volume });
  }

  async setMute(deviceId: string, mute: boolean) {
    if (!this.isActiveDevice(deviceId)) return;
    this.patchDevice(deviceId, { mute });
    await invoke('set_audio_device_mute', { deviceId, mute });
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
}
