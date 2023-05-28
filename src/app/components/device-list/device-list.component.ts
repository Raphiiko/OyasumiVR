import { ChangeDetectorRef, Component, DestroyRef, OnInit } from '@angular/core';
import { map, tap } from 'rxjs';
import { flatten, groupBy, orderBy } from 'lodash';
import { fade, triggerChildren, vshrink } from 'src/app/utils/animations';
import { OVRDevice, OVRDeviceClass } from 'src/app/models/ovr-device';
import { LighthouseConsoleService } from '../../services/lighthouse-console.service';
import { OpenVRService } from '../../services/openvr.service';
import { EventLogTurnedOffDevices } from '../../models/event-log-entry';
import { EventLogService } from '../../services/event-log.service';
import { error } from 'tauri-plugin-log-api';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface DisplayCategory {
  label: string;
  devices: OVRDevice[];
  canPowerOff: boolean;
  class: OVRDeviceClass;
}

@Component({
  selector: 'app-device-list',
  templateUrl: './device-list.component.html',
  styleUrls: ['./device-list.component.scss'],
  animations: [vshrink(), triggerChildren(), fade()],
})
export class DeviceListComponent implements OnInit {
  deviceCategories: Array<DisplayCategory> = [];
  devicesCanPowerOff = false;

  constructor(
    protected openvr: OpenVRService,
    private cdr: ChangeDetectorRef,
    private lighthouse: LighthouseConsoleService,
    private eventLog: EventLogService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.openvr.devices
      .pipe(
        takeUntilDestroyed(this.destroyRef),
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
                (category = {
                  label: categoryLabel,
                  devices: [],
                  canPowerOff: false,
                  class: deviceGroup[0],
                })
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

  trackDeviceCategoryBy(index: number, category: DisplayCategory) {
    return category.label;
  }

  async turnOffDevices(category: DisplayCategory) {
    const devices = category.devices.filter((d) => d.canPowerOff);
    if (!devices.length) return;
    await this.lighthouse.turnOffDevices(devices);
    this.eventLog.logEvent({
      type: 'turnedOffDevices',
      reason: 'MANUAL',
      devices: (() => {
        switch (category.class) {
          case 'Controller':
            return devices.length > 1 ? 'CONTROLLERS' : 'CONTROLLER';
          case 'GenericTracker':
            return devices.length > 1 ? 'TRACKERS' : 'TRACKER';
          default:
            error(
              `[DeviceList] Couldn't determine device class for event log entry (${category.class})`
            );
            return 'VARIOUS';
        }
      })(),
    } as EventLogTurnedOffDevices);
  }

  async turnOffAllDevices() {
    const devices = flatten(this.deviceCategories.map((c) => c.devices)).filter(
      (d) => d.canPowerOff
    );
    if (!devices.length) return;
    await this.lighthouse.turnOffDevices(devices);
    this.eventLog.logEvent({
      type: 'turnedOffDevices',
      reason: 'MANUAL',
      devices: 'ALL',
    } as EventLogTurnedOffDevices);
  }
}
