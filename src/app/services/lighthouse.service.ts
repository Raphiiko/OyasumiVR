import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class LighthouseService {
  constructor() {}

  async init() {
    listen('LIGHTHOUSE_STATUS_CHANGED', (event) => this.handleStatusChange(event.payload));
    listen('LIGHTHOUSE_SCANNING_STATUS_CHANGED', (event) =>
      this.handleScanningStatusChange(event.payload)
    );
    listen('EVENT_DEVICE_DISCOVERED', (event) => this.handleDeviceDiscovered(event.payload));
    listen('EVENT_DEVICE_POWER_STATE_CHANGED', (event) =>
      this.handleDevicePowerStateChange(event.payload)
    );

    await invoke('lighthouse_start_scan', { duration: 10 });
  }

  handleStatusChange(event: any) {
    console.log('STATUS CHANGE', event);
  }

  handleScanningStatusChange(event: any) {
    console.log('SCANNING STATUS CHANGE', event);
  }

  handleDeviceDiscovered(event: any) {
    console.log('DEVICE DISCOVERED', event);
  }

  handleDevicePowerStateChange(event: any) {
    console.log('POWER STATE CHANGE', event);
  }
}
