import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  input,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DMKnownDevice } from '../../../models/device-manager';
import { DeviceManagerService } from '../../../services/device-manager.service';
import { SteamFrameDeviceService } from '../../../services/steam-frame/steam-frame-device.service';

/** The Steam Frame tab of the device page: pairing, the OyasumiVR helper, and unpairing. */
@Component({
  selector: 'app-steam-frame-device-tab',
  templateUrl: './steam-frame-device-tab.component.html',
  styleUrls: ['./steam-frame-device-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SteamFrameDeviceTabComponent {
  readonly device = input.required<DMKnownDevice>();

  constructor(
    protected frames: SteamFrameDeviceService,
    deviceManager: DeviceManagerService,
    cdr: ChangeDetectorRef,
    destroyRef: DestroyRef
  ) {
    // whether SteamVR uses the headset decides the Pair buttons, and the device object can stay the same
    deviceManager.observedDevices
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(() => cdr.markForCheck());
  }
}
