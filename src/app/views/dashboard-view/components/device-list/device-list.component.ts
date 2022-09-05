import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { map, Subject, takeUntil, tap } from 'rxjs';
import { flatten, groupBy, orderBy } from 'lodash';
import { fade, triggerChildren, vshrink } from 'src/app/utils/animations';
import { OVRDevice, OVRDeviceClass } from '../../../../models/ovr-device';
import { OpenVRService } from '../../../../services/openvr.service';
import { LighthouseService } from '../../../../services/lighthouse.service';

interface DisplayCategory {
  label: string;
  devices: OVRDevice[];
  canPowerOff: boolean;
}

@Component({
  selector: 'app-device-list',
  templateUrl: './device-list.component.html',
  styleUrls: ['./device-list.component.scss'],
  animations: [vshrink(), triggerChildren(), fade()],
})
export class DeviceListComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  deviceCategories: Array<DisplayCategory> = [];
  devicesCanPowerOff: boolean = false;

  constructor(
    protected openvr: OpenVRService,
    private cdr: ChangeDetectorRef,
    private lighthouse: LighthouseService
  ) {}

  ngOnInit(): void {
    this.openvr.devices
      .pipe(
        takeUntil(this.destroy$),
        map((devices) => devices.filter((d) => ['GenericTracker', 'Controller'].includes(d.class))),
        map(
          (devices) =>
            Object.entries(groupBy(devices, 'class')) as Array<[OVRDeviceClass, OVRDevice[]]>
        ),
        tap((groupedDevices) => {
          groupedDevices.forEach((deviceGroup) => {
            const categoryLabel = this.getCategoryLabelForDeviceClass(deviceGroup[0]);
            let category = this.deviceCategories.find((c) => c.label === categoryLabel);
            if (!category) {
              this.deviceCategories.push(
                (category = { label: categoryLabel, devices: [], canPowerOff: false })
              );
            }
            for (const device of deviceGroup[1]) {
              const currentDevice = category.devices.find((d) => d.index === device.index);
              if (currentDevice) Object.assign(currentDevice, device);
              else category.devices.push(device);
            }
            category.devices.sort((a, b) => b.index - a.index);
            category.canPowerOff = !!category.devices.find(
              (device) => device.canPowerOff && device.dongleId && !device.isTurningOff
            );
          });
          this.deviceCategories = orderBy(this.deviceCategories, ['label'], ['asc']);
          this.devicesCanPowerOff = !!this.deviceCategories.find((c) => c.canPowerOff);
        })
      )
      .subscribe();
  }

  getCategoryLabelForDeviceClass(deviceClass: OVRDeviceClass): string {
    switch (deviceClass) {
      case 'Controller':
        return 'device-list.category.Controller';
      case 'GenericTracker':
        return 'device-list.category.GenericTracker';
      default:
        return 'device-list.category.other';
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
  }

  trackDeviceCategoryBy(index: number, category: DisplayCategory) {
    return category.label;
  }

  turnOffDevices(devices: OVRDevice[]) {
    this.lighthouse.turnOffDevices(devices);
  }

  turnOffAllDevices() {
    this.lighthouse.turnOffDevices(flatten(this.deviceCategories.map((c) => c.devices)));
  }
}
