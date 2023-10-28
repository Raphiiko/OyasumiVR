import { Component } from '@angular/core';
import { AudioDeviceService } from '../../../services/audio-device.service';
import { AudioDevice } from '../../../models/audio-device';
import { map, Observable } from 'rxjs';

@Component({
  selector: 'app-debug-audio-device-debugger',
  templateUrl: './debug-audio-device-debugger.component.html',
  styleUrls: ['./debug-audio-device-debugger.component.scss'],
})
export class DebugAudioDeviceDebuggerComponent {
  protected renderDevices: Observable<AudioDevice[]>;
  protected captureDevices: Observable<AudioDevice[]>;

  constructor(protected audioDeviceService: AudioDeviceService) {
    this.renderDevices = this.audioDeviceService.activeDevices.pipe(
      map((devices) => devices.filter((d) => d.deviceType === 'Render'))
    );
    this.captureDevices = this.audioDeviceService.activeDevices.pipe(
      map((devices) => devices.filter((d) => d.deviceType === 'Capture'))
    );
  }

  protected trackDeviceBy(index: number, device: AudioDevice): string {
    return device.id;
  }
}
