import { ChangeDetectorRef, Component, DestroyRef, OnInit } from '@angular/core';
import { flatten, groupBy, uniq } from 'lodash';
import { fade, hshrink, triggerChildren, vshrink } from 'src-ui/app/utils/animations';
import { OVRDevice, OVRDeviceClass } from 'src-ui/app/models/ovr-device';
import { LighthouseConsoleService } from '../../services/lighthouse-console.service';
import { OpenVRService } from '../../services/openvr.service';
import {
  EventLogLighthouseSetPowerState,
  EventLogTurnedOffOpenVRDevices,
} from '../../models/event-log-entry';
import { EventLogService } from '../../services/event-log.service';
import { error } from '@tauri-apps/plugin-log';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LighthouseDevice, LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { filterInPlace } from 'src-ui/app/utils/arrays';
import { combineLatest, debounceTime, firstValueFrom, tap } from 'rxjs';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import {
  DevicePowerState,
  DevicePowerAction,
} from '../device-power-button/device-power-button.component';
import { DeviceManagerService } from '../../services/device-manager.service';

type DisplayCategory = OpenVRDisplayCategory | LighthouseDisplayCategory;

interface BaseDisplayCategory {
  type: 'OpenVR' | 'Lighthouse';
  label: string;
  icon?: string;
}

interface OpenVRDisplayCategory extends BaseDisplayCategory {
  type: 'OpenVR';
  devices: OVRDevice[];
  canBulkPowerOff: boolean;
  class: OVRDeviceClass;
}

interface LighthouseDisplayCategory extends BaseDisplayCategory {
  type: 'Lighthouse';
  devices: LighthouseDevice[];
  canBulkPowerOn: boolean;
  canBulkPowerOff: boolean;
}

@Component({
  selector: 'app-device-list',
  templateUrl: './device-list.component.html',
  styleUrls: ['./device-list.component.scss'],
  animations: [vshrink(), triggerChildren(), fade(), hshrink()],
  standalone: false,
})
export class DeviceListComponent implements OnInit {
  deviceCategories: Array<DisplayCategory> = [];
  devicesCanPowerOff = false;
  scanningForLighthouses = false;
  lighthousePowerControl = false;
  showLHStatePopover = false;

  constructor(
    protected openvr: OpenVRService,
    private cdr: ChangeDetectorRef,
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private eventLog: EventLogService,
    private destroyRef: DestroyRef,
    private appSettings: AppSettingsService,
    private deviceManager: DeviceManagerService
  ) {}

  ngOnInit(): void {
    combineLatest([
      this.openvr.devices.pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((devices) => this.processOpenVRDevices(devices))
      ),
      this.lighthouse.devices.pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((devices) => this.processLighthouseDevices(devices))
      ),
    ])
      .pipe(tap(() => this.sortDeviceCategories()))
      .subscribe();
    this.lighthouse.scanning.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((scanning) => {
      this.scanningForLighthouses = scanning;
    });
    this.appSettings.settings
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(100))
      .subscribe((settings) => (this.lighthousePowerControl = settings.lighthousePowerControl));
  }

  processOpenVRDevices(devices: OVRDevice[]) {
    // Filter out non-hmd, non-controller and non-tracker devices
    devices = devices.filter((device) =>
      ['HMD', 'Controller', 'GenericTracker'].includes(device.class)
    );
    // Filter out hidden devices
    devices = devices.filter((device) => !this.isOpenVRDeviceHidden(device));
    // Add missing device categories
    uniq(devices.map((device) => device.class))
      .filter(
        (deviceClass) =>
          !this.deviceCategories.some((c) => c.type === 'OpenVR' && c.class === deviceClass)
      )
      .forEach((deviceClass) => {
        this.deviceCategories.push({
          type: 'OpenVR',
          label: this.getCategoryLabelForOpenVRDeviceClass(deviceClass),
          devices: [],
          class: deviceClass,
          canBulkPowerOff: false,
          icon: this.getIconForOpenVRDeviceClass(deviceClass),
        });
      });
    // Remove obsolete device categories
    filterInPlace(
      this.deviceCategories,
      (c) => c.type !== 'OpenVR' || devices.some((d) => d.class === c.class)
    );
    // Group devices by their class
    const devicesByClass = groupBy(devices, (device) => device.class);
    for (const [deviceClass, devices] of Object.entries(devicesByClass)) {
      // Add missing devices
      const category = this.deviceCategories.find(
        (c) => c.type === 'OpenVR' && c.class === deviceClass
      ) as OpenVRDisplayCategory;
      devices
        .filter((device) => !category.devices.some((d) => d.index === device.index))
        .forEach((device) => {
          category.devices.push(device);
        });
      // Remove obsolete devices
      filterInPlace(category.devices, (d) => devices.some((device) => device.index === d.index));
      // Update existing devices
      for (const device of devices) {
        const existingDevice = category.devices.find((d) => d.index === device.index);
        if (!existingDevice) continue;
        Object.assign(existingDevice, device);
      }
      // Sort devices in place
      category.devices.sort((a, b) => a.index - b.index);
      // Update category power state
      category.canBulkPowerOff = category.devices.some((d) => d.canPowerOff);
    }
    // Update devicesCanPowerOff
    this.devicesCanPowerOff = devices.some((d) => d.canPowerOff);
  }

  getIconForOpenVRDeviceClass(deviceClass: OVRDeviceClass): string | undefined {
    switch (deviceClass) {
      case 'Controller':
        return 'controller';
      case 'GenericTracker':
        return 'tracker';
      case 'HMD':
        return 'hmd';
      case 'TrackingReference':
      case 'DisplayRedirect':
      case 'Invalid':
      default:
        return undefined;
    }
  }

  processLighthouseDevices(devices: LighthouseDevice[]) {
    // Filter out hidden devices
    devices = devices.filter((device) => !this.isLighthouseDeviceHidden(device));
    // Add missing device category
    if (devices.length && !this.deviceCategories.some((c) => c.type === 'Lighthouse')) {
      this.deviceCategories.push({
        type: 'Lighthouse',
        label: 'comp.device-list.category.Lighthouse',
        devices: [],
        canBulkPowerOn: false,
        canBulkPowerOff: false,
        icon: 'lighthouse',
      });
    }
    // Remove obsolete device category
    else if (!devices.length && this.deviceCategories.some((c) => c.type === 'Lighthouse')) {
      filterInPlace(this.deviceCategories, (c) => c.type !== 'Lighthouse');
    }
    // Stop here if there are no devices
    if (!devices.length) return;
    // Get the category
    const category = this.deviceCategories.find(
      (c) => c.type === 'Lighthouse'
    ) as LighthouseDisplayCategory;
    // Update category devices
    devices.forEach((device) => {
      // Add missing device
      if (!category.devices.some((d) => d.id === device.id)) {
        category.devices.push(device);
        return;
      }
      // Update existing device
      const existingDevice = category.devices.find((d) => d.id === device.id);
      if (device) Object.assign(existingDevice!, device);
    });
    // Remove obsolete devices
    filterInPlace(category.devices, (d) => devices.some((device) => device.id === d.id));
    // Sort devices in place
    category.devices.sort((a, b) => {
      return a.id.localeCompare(b.id);
    });
    // Update category power state
    category.canBulkPowerOn = category.devices.some(
      (d) => d.powerState === 'standby' || d.powerState === 'sleep'
    );
    category.canBulkPowerOff =
      !category.canBulkPowerOn &&
      category.devices.some((d) => d.powerState === 'on' || d.powerState === 'booting');
  }

  sortDeviceCategories() {
    const sortKeys = ['OpenVR-HMD', 'OpenVR-Controller', 'OpenVR-GenericTracker', 'Lighthouse'];
    const getKey = (category: DisplayCategory) => {
      switch (category.type) {
        case 'OpenVR':
          return `OpenVR-${category.class}`;
        case 'Lighthouse':
          return 'Lighthouse';
      }
    };
    this.deviceCategories.sort((a, b) => sortKeys.indexOf(getKey(a)) - sortKeys.indexOf(getKey(b)));
    this.cdr.detectChanges();
  }

  getCategoryLabelForOpenVRDeviceClass(deviceClass: OVRDeviceClass): string {
    switch (deviceClass) {
      case 'HMD':
        return 'comp.device-list.category.HMD';
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

  async turnOffOVRDevices(category: OpenVRDisplayCategory) {
    const devices = category.devices.filter((d) => d.canPowerOff && !this.isOpenVRDeviceHidden(d));
    if (!devices.length) return;
    await this.lighthouseConsole.turnOffDevices(devices);
    this.eventLog.logEvent({
      type: 'turnedOffOpenVRDevices',
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
    } as EventLogTurnedOffOpenVRDevices);
  }

  async clickBulkPowerLighthouseDevices(category: LighthouseDisplayCategory) {
    this.bulkPowerLighthouseDevices(category);
  }

  async rightClickBulkPowerLighthouseDevices() {
    this.showLHStatePopover = !this.showLHStatePopover;
  }

  async bulkPowerLighthouseDevices(category: LighthouseDisplayCategory) {
    if (category.canBulkPowerOn) {
      const devices = category.devices.filter(
        (d) =>
          (d.powerState === 'standby' || d.powerState === 'sleep' || d.powerState === 'unknown') &&
          !this.isLighthouseDeviceHidden(d)
      );
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'MANUAL',
        state: 'on',
        devices: 'ALL',
      } as EventLogLighthouseSetPowerState);
      await Promise.all(devices.map(async (device) => this.lighthouse.setPowerState(device, 'on')));
    } else if (category.canBulkPowerOff) {
      const powerOffState = (await firstValueFrom(this.appSettings.settings))
        .lighthousePowerOffState;
      const devices = category.devices.filter(
        (d) =>
          (d.powerState === 'on' || d.powerState === 'unknown' || d.powerState === 'booting') &&
          !this.isLighthouseDeviceHidden(d)
      );
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'MANUAL',
        state: powerOffState,
        devices: 'ALL',
      } as EventLogLighthouseSetPowerState);
      await Promise.all(
        devices.map(async (device) => {
          return this.lighthouse.setPowerState(device, powerOffState);
        })
      );
    }
  }

  async turnOffAllOVRDevices() {
    const devices = flatten(
      this.deviceCategories
        .filter((c) => c.type === 'OpenVR')
        .map((c) => (c as OpenVRDisplayCategory).devices)
    ).filter((d) => d.canPowerOff && !this.isOpenVRDeviceHidden(d));
    if (!devices.length) return;
    await this.lighthouseConsole.turnOffDevices(devices);
    this.eventLog.logEvent({
      type: 'turnedOffOpenVRDevices',
      reason: 'MANUAL',
      devices: 'ALL',
    } as EventLogTurnedOffOpenVRDevices);
  }

  onClickOutsideLHStatePopover($event: MouseEvent) {
    const targetId = ($event.target as HTMLElement).id;
    if (targetId !== 'btn-lh-bulk-power') {
      this.showLHStatePopover = false;
    }
  }

  async onForceLHState(state: LighthouseDevicePowerState) {
    let devices = this.deviceCategories
      .filter((c) => c.type === 'Lighthouse')
      .map((c) => (c as LighthouseDisplayCategory).devices)
      .flat();
    if (state === 'on') {
      devices = devices.filter((d) => d.powerState !== 'on');
    }
    // Filter out hidden devices
    devices = devices.filter((d) => !this.isLighthouseDeviceHidden(d));
    if (!devices.length) return;
    this.eventLog.logEvent({
      type: 'lighthouseSetPowerState',
      reason: 'MANUAL',
      state,
      devices: 'ALL',
    } as EventLogLighthouseSetPowerState);
    await Promise.all(devices.map(async (device) => this.lighthouse.setPowerState(device, state)));
  }

  // Helper methods for checking if devices are hidden
  private isOpenVRDeviceHidden(device: OVRDevice): boolean {
    const deviceId = this.deviceManager.getIdForOpenVRDevice(device);
    const knownDevice = this.deviceManager.getKnownDeviceById(deviceId);
    return knownDevice?.disabled ?? false;
  }

  private isLighthouseDeviceHidden(device: LighthouseDevice): boolean {
    const deviceId = this.deviceManager.getIdForLighthouseDevice(device);
    const knownDevice = this.deviceManager.getKnownDeviceById(deviceId);
    return knownDevice?.disabled ?? false;
  }

  // Helper methods for power button component
  getBulkLighthousePowerState(category: LighthouseDisplayCategory): DevicePowerState {
    if (category.canBulkPowerOn) {
      return 'off';
    } else if (category.canBulkPowerOff) {
      return 'on';
    }
    return 'unknown';
  }

  canShowBulkLighthousePowerButton(category: LighthouseDisplayCategory): boolean {
    return category.canBulkPowerOn || category.canBulkPowerOff;
  }

  async handleBulkLighthousePowerAction(
    category: LighthouseDisplayCategory,
    action: DevicePowerAction
  ) {
    if (action === 'power-on' || action === 'power-off') {
      await this.clickBulkPowerLighthouseDevices(category);
    }
  }
}
