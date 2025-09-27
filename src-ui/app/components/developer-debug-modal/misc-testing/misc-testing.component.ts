import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { SteamService } from 'src-ui/app/services/steam.service';
import { ADBService } from 'src-ui/app/services/adb.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  @Input() modal?: BaseModalComponent<any, any>;

  // Properties to store ADB results
  serverStatus: any;
  devices: any;
  deviceStatus: any;
  brightness: any;
  selectedDeviceId: string = '';

  constructor(private adb: ADBService) {}

  async getServerStatus() {
    try {
      this.serverStatus = await this.adb.adbGetServerStatus();
    } catch (error) {
      console.error('Error getting server status:', error);
      this.serverStatus = { error: error };
    }
  }

  async getDevices() {
    try {
      this.devices = await this.adb.adbGetDevices();
      // Auto-select first device if available
      if (this.devices && Array.isArray(this.devices) && this.devices.length > 0) {
        this.selectedDeviceId = this.devices[0].identifier;
      }
    } catch (error) {
      console.error('Error getting devices:', error);
      this.devices = { error: error };
    }
  }

  async getDeviceStatus() {
    if (!this.selectedDeviceId) {
      this.deviceStatus = { error: 'No device selected. Get devices first.' };
      return;
    }
    try {
      this.deviceStatus = await this.adb.adbGetDeviceStatus(this.selectedDeviceId);
    } catch (error) {
      console.error('Error getting device status:', error);
      this.deviceStatus = { error: error };
    }
  }

  async setBrightness(brightness: number) {
    if (!this.selectedDeviceId) {
      console.error('No device selected. Get devices first.');
      return;
    }
    try {
      await this.adb.adbSetBrightness(this.selectedDeviceId, brightness);
      // Refresh brightness value after setting
      await this.getBrightness();
    } catch (error) {
      console.error('Error setting brightness:', error);
    }
  }

  async getBrightness() {
    if (!this.selectedDeviceId) {
      this.brightness = { error: 'No device selected. Get devices first.' };
      return;
    }
    try {
      this.brightness = await this.adb.adbGetBrightness(this.selectedDeviceId);
    } catch (error) {
      console.error('Error getting brightness:', error);
      this.brightness = { error: error };
    }
  }
}
