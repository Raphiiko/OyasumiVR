import { Component, OnInit, DestroyRef } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fadeUp } from 'src-ui/app/utils/animations';
import {
  DeviceSelection,
  DMKnownDevice,
  DMDeviceTag,
  DMDeviceType,
  DMDeviceTypes,
} from 'src-ui/app/models/device-manager';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { OVRDevice } from 'src-ui/app/models/ovr-device';
import { LighthouseDevice } from 'src-ui/app/models/lighthouse-device';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest } from 'rxjs';

export interface DeviceSelectorModalInputModel {
  selection?: DeviceSelection;
  allowedDeviceTypes?: DMDeviceType[];
}

export interface DeviceSelectorModalOutputModel {
  selection: DeviceSelection;
  save: boolean;
}

interface DeviceGroup {
  type: DMDeviceType;
  devices: DMKnownDevice[];
  icon: string;
  label: string;
}

@Component({
  selector: 'app-device-selector-modal',
  templateUrl: './device-selector-modal.component.html',
  styleUrls: ['./device-selector-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class DeviceSelectorModalComponent
  extends BaseModalComponent<DeviceSelectorModalInputModel, DeviceSelectorModalOutputModel>
  implements OnInit, DeviceSelectorModalInputModel
{
  selection?: DeviceSelection;
  allowedDeviceTypes?: DMDeviceType[];

  // Data
  knownDevices: DMKnownDevice[] = [];
  tags: DMDeviceTag[] = [];
  deviceGroups: DeviceGroup[] = [];
  deviceTypes: DMDeviceType[] = [...DMDeviceTypes];
  filteredDeviceTypes: DMDeviceType[] = [...DMDeviceTypes];
  ovrDevices: OVRDevice[] = [];
  lighthouseDevices: LighthouseDevice[] = [];

  constructor(
    private deviceManager: DeviceManagerService,
    private openVRService: OpenVRService,
    private lighthouseService: LighthouseService,
    private destroyRef: DestroyRef
  ) {
    super();
    this.result = {
      selection: {
        devices: [],
        types: [],
        tagIds: [],
      },
      save: false,
    };
  }

  ngOnInit(): void {
    // Initialize with provided selection or default empty selection
    if (this.selection) {
      this.result!.selection = { ...this.selection };
    }

    // Initialize filtered device types based on allowed types
    this.filteredDeviceTypes = this.allowedDeviceTypes
      ? this.deviceTypes.filter((type) => this.allowedDeviceTypes!.includes(type))
      : [...this.deviceTypes];

    // Subscribe to device manager data
    combineLatest([
      this.deviceManager.knownDevices,
      this.deviceManager.tags,
      this.openVRService.devices,
      this.lighthouseService.devices,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([knownDevices, tags, ovrDevices, lighthouseDevices]) => {
        this.knownDevices = knownDevices;
        this.tags = tags;
        this.ovrDevices = ovrDevices;
        this.lighthouseDevices = lighthouseDevices;
        this.updateDeviceGroups();
      });
  }

  private updateDeviceGroups() {
    const groupMap = new Map<DMDeviceType, DMKnownDevice[]>();

    // Initialize groups for filtered device types only
    for (const type of this.filteredDeviceTypes) {
      groupMap.set(type, []);
    }

    // Group devices by type, only including devices with allowed types
    for (const device of this.knownDevices) {
      if (this.filteredDeviceTypes.includes(device.deviceType)) {
        const group = groupMap.get(device.deviceType);
        if (group) {
          group.push(device);
        }
      }
    }

    // Create device groups
    this.deviceGroups = [];
    for (const type of this.filteredDeviceTypes) {
      const devices = groupMap.get(type) || [];
      if (devices.length > 0) {
        this.deviceGroups.push({
          type,
          devices: devices.sort((a, b) =>
            this.getDeviceDisplayName(a).localeCompare(this.getDeviceDisplayName(b))
          ),
          icon: this.getDeviceTypeIcon(type),
          label: `device-manager.deviceType.${type}`,
        });
      }
    }

    // Auto-deselect tags that are no longer applicable
    this.autoDeselectInapplicableTags();
  }

  // Device type selection methods
  isDeviceTypeSelected(type: DMDeviceType): boolean {
    return this.result!.selection.types.includes(type);
  }

  toggleDeviceType(type: DMDeviceType) {
    const types = this.result!.selection.types;
    const index = types.indexOf(type);
    if (index >= 0) {
      types.splice(index, 1);
    } else {
      types.push(type);
      // When selecting a device type, deselect all individual devices of that type
      this.deselectDevicesOfType(type);
    }
  }

  private deselectDevicesOfType(deviceType: DMDeviceType) {
    const devicesOfType = this.knownDevices
      .filter((device) => device.deviceType === deviceType)
      .map((device) => device.id);

    this.result!.selection.devices = this.result!.selection.devices.filter(
      (deviceId) => !devicesOfType.includes(deviceId)
    );
  }

  // Tag selection methods
  isTagSelected(tagId: string): boolean {
    return this.result!.selection.tagIds.includes(tagId);
  }

  toggleTag(tagId: string) {
    // Don't allow selection of inapplicable tags
    if (!this.isTagApplicable(tagId)) {
      return;
    }

    const tagIds = this.result!.selection.tagIds;
    const index = tagIds.indexOf(tagId);
    if (index >= 0) {
      tagIds.splice(index, 1);
    } else {
      tagIds.push(tagId);
    }
  }

  // Device selection methods
  isDeviceSelected(deviceId: string): boolean {
    return this.result!.selection.devices.includes(deviceId);
  }

  toggleDevice(deviceId: string) {
    const device = this.knownDevices.find((d) => d.id === deviceId);
    if (!device || this.isDeviceGroupDisabled(device.deviceType)) {
      return; // Don't allow selection if device type is selected
    }

    const devices = this.result!.selection.devices;
    const index = devices.indexOf(deviceId);
    if (index >= 0) {
      devices.splice(index, 1);
    } else {
      devices.push(deviceId);
    }
  }

  isDeviceGroupDisabled(deviceType: DMDeviceType): boolean {
    return this.isDeviceTypeSelected(deviceType);
  }

  deselectAll() {
    this.result!.selection = {
      devices: [],
      types: [],
      tagIds: [],
    };
  }

  hasAnySelection(): boolean {
    const selection = this.result!.selection;
    return (
      selection.devices.length > 0 || selection.types.length > 0 || selection.tagIds.length > 0
    );
  }

  // Utility methods
  getDeviceTypeIcon(type: DMDeviceType): string {
    switch (type) {
      case 'HMD':
        return 'hmd';
      case 'CONTROLLER':
        return 'controller';
      case 'TRACKER':
        return 'tracker';
      case 'LIGHTHOUSE':
        return 'lighthouse';
      default:
        return 'device';
    }
  }

  getDeviceTypeDisplayName(type: DMDeviceType): string {
    return `device-manager.deviceSelector.deviceTypes.${type}`;
  }

  getDeviceDisplayName(device: DMKnownDevice): string {
    return device.nickname || device.defaultName;
  }

  getDeviceTags(device: DMKnownDevice): DMDeviceTag[] {
    return this.tags.filter((tag) => device.tagIds.includes(tag.id));
  }

  getDeviceSerialNumber(device: DMKnownDevice): string | null {
    const ovrDevice = this.getDeviceOVR(device);
    if (ovrDevice && ovrDevice.serialNumber) {
      return ovrDevice.serialNumber;
    }
    const lighthouseDevice = this.getDeviceLighthouse(device);
    if (lighthouseDevice && lighthouseDevice.deviceName) {
      return lighthouseDevice.deviceName;
    }
    return null;
  }

  getDeviceRole(device: DMKnownDevice): string | null {
    const ovrDevice = this.getDeviceOVR(device);
    if (ovrDevice && ovrDevice.handleType) {
      return `comp.device-list.deviceRole.${ovrDevice.handleType}`;
    }
    return null;
  }

  getDeviceOVR(device: DMKnownDevice): OVRDevice | undefined {
    if (!device.id.startsWith('OVR_')) return undefined;
    return this.ovrDevices.find((d) => this.deviceManager['getIdForOpenVRDevice'](d) === device.id);
  }

  getDeviceLighthouse(device: DMKnownDevice): LighthouseDevice | undefined {
    if (!device.id.startsWith('LH_')) return undefined;
    return this.lighthouseDevices.find(
      (d) => this.deviceManager['getIdForLighthouseDevice'](d) === device.id
    );
  }

  // Track by functions
  trackDeviceGroupBy(index: number, group: DeviceGroup): string {
    return group.type;
  }

  trackDeviceBy(index: number, device: DMKnownDevice): string {
    return device.id;
  }

  trackTagBy(index: number, tag: DMDeviceTag): string {
    return tag.id;
  }

  trackDeviceTypeBy(index: number, type: DMDeviceType): string {
    return type;
  }

  async cancel() {
    this.result!.save = false;
    await this.close();
  }

  async confirm() {
    this.result!.save = true;
    await this.close();
  }

  isTagApplicable(tagId: string): boolean {
    // A tag is applicable if at least one known device with allowed type has this tag
    return this.knownDevices.some(
      (device) =>
        this.filteredDeviceTypes.includes(device.deviceType) && device.tagIds.includes(tagId)
    );
  }

  private autoDeselectInapplicableTags() {
    // Auto-deselect tags that are no longer applicable
    const inapplicableSelectedTags = this.result!.selection.tagIds.filter(
      (tagId) => !this.isTagApplicable(tagId)
    );

    for (const tagId of inapplicableSelectedTags) {
      const index = this.result!.selection.tagIds.indexOf(tagId);
      if (index >= 0) {
        this.result!.selection.tagIds.splice(index, 1);
      }
    }
  }
}
