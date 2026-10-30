import { ChangeDetectorRef, Component, input } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DMKnownDevice } from 'src-ui/app/models/device-manager';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { SteamFrameDeviceViewService } from 'src-ui/app/views/dashboard-view/views/device-manager-view/steam-frame-device-view.service';

/** The Steam Frame tab of the device page: pairing, the OyasumiVR helper, and unpairing. */
@Component({
  selector: 'app-steam-frame-device-tab',
  templateUrl: './steam-frame-device-tab.component.html',
  styleUrls: ['./steam-frame-device-tab.component.scss'],
  standalone: false,
})
export class SteamFrameDeviceTabComponent {
  readonly device = input.required<DMKnownDevice>();

  constructor(
    protected frames: SteamFrameDeviceViewService,
    deviceManager: DeviceManagerService,
    cdr: ChangeDetectorRef
  ) {
    // whether SteamVR uses the headset decides the Pair buttons, and the device object can stay the same
    deviceManager.observedDevices.pipe(takeUntilDestroyed()).subscribe(() => cdr.markForCheck());
  }
}
