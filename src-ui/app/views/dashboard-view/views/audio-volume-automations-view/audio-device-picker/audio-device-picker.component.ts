import { Component } from '@angular/core';
import { BaseModalComponent } from '../../../../../components/base-modal/base-modal.component';
import { fadeRight } from '../../../../../utils/animations';
import { AudioDeviceService } from '../../../../../services/audio-device.service';
import { AudioDevice, AudioDeviceType } from '../../../../../models/audio-device';
import { EMPTY, map, Observable } from 'rxjs';

export interface AudioDevicePickerInput {
  disablePersistentIds?: string[];
}

export interface AudioDevicePickerOutput {
  device: AudioDevice;
}

@Component({
  selector: 'app-audio-device-picker',
  templateUrl: './audio-device-picker.component.html',
  styleUrls: ['./audio-device-picker.component.scss'],
  animations: [fadeRight('fadeRight', '0.3s ease')],
})
export class AudioDevicePickerComponent extends BaseModalComponent<
  AudioDevicePickerInput,
  AudioDevicePickerOutput
> {
  disablePersistentIds?: string[];
  _deviceType: AudioDeviceType = 'Render';
  get deviceType() {
    return this._deviceType;
  }

  set deviceType(type: AudioDeviceType) {
    this._deviceType = type;
    this.options = this.audioDeviceService.activeDevices.pipe(
      // Filter by type
      map((devices) => devices.filter((device) => device.deviceType === type)),
      // Add default option
      map((devices) => {
        const defaultDevice = structuredClone(devices.find((device) => device.default));
        if (defaultDevice) {
          defaultDevice.persistentId = 'DEFAULT_' + defaultDevice.deviceType.toUpperCase();
          return [defaultDevice, ...devices];
        }
        return devices;
      })
    );
  }

  options: Observable<AudioDevice[]> = EMPTY;

  constructor(private audioDeviceService: AudioDeviceService) {
    super();
    this.deviceType = 'Render';
  }

  selectDevice(device: AudioDevice) {
    this.result = { device };
    this.close();
  }
}
