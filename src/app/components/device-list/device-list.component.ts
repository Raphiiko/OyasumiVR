import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { map, Subject, takeUntil, tap } from 'rxjs';
import { flatten, groupBy, orderBy } from 'lodash';
import { fade, triggerChildren, vshrink } from 'src/app/utils/animations';
import { OVRDevice, OVRDeviceClass } from 'src/app/models/ovr-device';
import { LighthouseService } from '../../services/lighthouse.service';
import { OpenVRService } from '../../services/openvr.service';

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
  devicesCanPowerOff = false;

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
            [devices, Object.entries(groupBy(devices, 'class'))] as [
              OVRDevice[],
              Array<[OVRDeviceClass, OVRDevice[]]>
            ]
        ),
        tap(([devices, groupedDevices]) => {
          // Group devices into categories and add categories if necessary
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
          // Remove devices that have gone
          this.deviceCategories.forEach((category) => {
            category.devices
              .filter((d) => !devices.find((_d) => _d.index === d.index))
              .forEach((removedDevice) => {
                category.devices.splice(category.devices.indexOf(removedDevice), 1);
              });
          });
          // Remove empty categories
          this.deviceCategories
            .filter((category) => !category.devices.length)
            .forEach((emptyCategory) => {
              this.deviceCategories.splice(this.deviceCategories.indexOf(emptyCategory), 1);
            });
          // Order categories
          this.deviceCategories = orderBy(this.deviceCategories, ['label'], ['asc']);
          // Flag if group poweroff is possible
          this.devicesCanPowerOff = !!this.deviceCategories.find((c) => c.canPowerOff);
        })
      )
      .subscribe();
  }

  getCategoryLabelForDeviceClass(deviceClass: OVRDeviceClass): string {
    switch (deviceClass) {
      case 'Controller':
        return 'comp.device-list.category.Controller';
      case 'GenericTracker':
        return 'comp.device-list.category.GenericTracker';
      default:
        return 'comp.device-list.category.other';
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
