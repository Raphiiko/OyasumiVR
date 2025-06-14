import { Component, OnInit, AfterViewInit, DestroyRef } from '@angular/core';
import { DeviceManagerService } from '../../../../../../services/device-manager.service';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { LighthouseService } from '../../../../../../services/lighthouse.service';
import { LighthouseConsoleService } from '../../../../../../services/lighthouse-console.service';
import { ModalService } from '../../../../../../services/modal.service';
import {
  DeviceManagerConfigModalComponent,
  DeviceManagerConfigModalInputModel,
  DeviceManagerConfigModalOutputModel,
} from '../../../../../../components/device-manager-config-modal/device-manager-config-modal.component';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../../../components/confirm-modal/confirm-modal.component';
import { DMKnownDevice, DMDeviceType, DMDeviceTag } from '../../../../../../models/device-manager';
import { OVRDevice } from '../../../../../../models/ovr-device';
import {
  LighthouseDevice,
  LighthouseDevicePowerState,
} from '../../../../../../models/lighthouse-device';
import { combineLatest, firstValueFrom } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DevicePowerState,
  DevicePowerAction,
} from '../../../../../../components/device-power-button/device-power-button.component';
import { fade, vshrink } from '../../../../../../utils/animations';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { DomSanitizer } from '@angular/platform-browser';
import Fuse from 'fuse.js';
import {
  LighthouseV1IdWizardModalComponent,
  LighthouseV1IdWizardModalOutputModel,
} from 'src-ui/app/components/lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';
import { LighthouseV1IdWizardModalInputModel } from 'src-ui/app/components/lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';

type DeviceGroupType = DMDeviceType | 'PREVIOUSLY_SEEN';

interface DeviceGroup {
  type: DeviceGroupType;
  devices: DMKnownDevice[];
  icon: string;
  label: string;
}

@Component({
  selector: 'app-device-manager-devices-tab',
  templateUrl: './device-manager-devices-tab.component.html',
  styleUrls: ['./device-manager-devices-tab.component.scss'],
  animations: [fade(), vshrink()],
  standalone: false,
})
export class DeviceManagerDevicesTabComponent implements OnInit, AfterViewInit {
  knownDevices: DMKnownDevice[] = [];
  observedDeviceIds: string[] = [];
  tags: DMDeviceTag[] = [];
  ovrDevices: OVRDevice[] = [];
  lighthouseDevices: LighthouseDevice[] = [];

  // Device filtering
  searchQuery = '';
  selectedTagFilter: string | null = null;
  selectedTagFilterOption: SelectBoxItem | undefined;

  // Lighthouse popover state
  showLHStatePopover = false;
  selectedPopoverDevice: DMKnownDevice | null = null;

  private _tagFilterOptions: SelectBoxItem[] = [];
  private _fuse: Fuse<DMKnownDevice> | null = null;

  constructor(
    private deviceManager: DeviceManagerService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseService,
    private lighthouseConsole: LighthouseConsoleService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer
  ) {}

  ngOnInit() {
    // Subscribe to device manager data
    combineLatest([
      this.deviceManager.knownDevices,
      this.deviceManager.observedDevices,
      this.deviceManager.tags,
      this.openvr.devices,
      this.lighthouse.devices,
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([knownDevices, observedDeviceIds, tags, ovrDevices, lighthouseDevices]) => {
        this.knownDevices = knownDevices;
        this.observedDeviceIds = observedDeviceIds;
        this.tags = tags;
        this.ovrDevices = ovrDevices;
        this.lighthouseDevices = lighthouseDevices;

        // Initialize Fuse.js with updated devices
        this.initializeFuse();
      });

    // Initialize tag filter to "All tags"
    this.updateTagFilterOptions();
    this.selectedTagFilterOption = this._tagFilterOptions[0];
  }

  ngAfterViewInit() {
    // Watch for tag changes to update filter options
    this.deviceManager.tags.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateTagFilterOptions();
    });
  }

  private updateTagFilterOptions() {
    this._tagFilterOptions = [
      {
        id: 'all',
        label: 'device-manager.filter.allTags',
        htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
          '<i class="material-icons" style="margin-right: 0.5em; color: var(--color-text-3);">filter_list</i>'
        ),
      },
    ];

    // Add tag options with color indicators
    for (const tag of this.tags) {
      this._tagFilterOptions.push({
        id: tag.id,
        label: tag.name,
        htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
          `<div style="width: 1em; height: 1em; border-radius: 50%; background-color: ${tag.color}; margin-right: 0.5em; flex-shrink: 0;"></div>`
        ),
      });
    }

    // Ensure "All tags" is selected if no current selection or current selection is invalid
    if (
      !this.selectedTagFilterOption ||
      !this._tagFilterOptions.find((opt) => opt.id === this.selectedTagFilterOption?.id)
    ) {
      this.selectedTagFilterOption = this._tagFilterOptions[0];
      this.selectedTagFilter = null;
    }
  }

  get tagFilterOptions(): SelectBoxItem[] {
    return this._tagFilterOptions;
  }

  private initializeFuse() {
    const fuseOptions: Fuse.IFuseOptions<DMKnownDevice> = {
      keys: [
        { name: 'nickname', weight: 2 },
        { name: 'defaultName', weight: 1.5 },
        { name: 'deviceType', weight: 1 },
      ],
      threshold: 0.4, // Lower threshold = more strict matching
      includeScore: true,
      includeMatches: true,
    };

    this._fuse = new Fuse(this.knownDevices, fuseOptions);
  }

  get filteredDevices(): DMKnownDevice[] {
    let filtered = this.knownDevices;

    // Apply search filter using Fuse.js for fuzzy search
    if (this.searchQuery.trim()) {
      if (this._fuse) {
        const searchResults = this._fuse.search(this.searchQuery.trim());
        filtered = searchResults.map((result) => result.item);
      } else {
        // Fallback to simple search if Fuse is not initialized
        const query = this.searchQuery.toLowerCase().trim();
        filtered = filtered.filter(
          (device) =>
            (device.nickname || device.defaultName).toLowerCase().includes(query) ||
            device.deviceType.toLowerCase().includes(query)
        );
      }
    }

    // Apply tag filter
    if (this.selectedTagFilter) {
      filtered = filtered.filter((device) => device.tagIds.includes(this.selectedTagFilter!));
    }

    return filtered;
  }

  get deviceGroups(): DeviceGroup[] {
    const devices = this.filteredDevices;
    const groups: DeviceGroup[] = [];

    // Separate observed and unobserved devices
    const observedDevices = devices.filter((device) => this.isDeviceObserved(device.id));
    const unobservedDevices = devices.filter((device) => !this.isDeviceObserved(device.id));

    // Sort observed devices by last seen
    observedDevices.sort((a, b) => b.lastSeen - a.lastSeen);

    // Sort unobserved devices by last seen
    unobservedDevices.sort((a, b) => b.lastSeen - a.lastSeen);

    // Group observed devices by type
    const observedTypeGroups = new Map<DMDeviceType, DMKnownDevice[]>();
    for (const device of observedDevices) {
      if (!observedTypeGroups.has(device.deviceType)) {
        observedTypeGroups.set(device.deviceType, []);
      }
      observedTypeGroups.get(device.deviceType)!.push(device);
    }

    // Define the desired order of device types
    const typeOrder: DMDeviceType[] = ['HMD', 'CONTROLLER', 'TRACKER', 'LIGHTHOUSE'];

    // Add observed device groups in the specified order
    for (const type of typeOrder) {
      const devices = observedTypeGroups.get(type);
      if (devices && devices.length > 0) {
        groups.push({
          type,
          devices,
          icon: this.getDeviceTypeIcon(type),
          label: this.getDeviceTypeLabel(type),
        });
      }
    }

    // Add unobserved devices as a separate "Previously Seen" group if any exist
    if (unobservedDevices.length > 0) {
      groups.push({
        type: 'PREVIOUSLY_SEEN' as DMDeviceType,
        devices: unobservedDevices,
        icon: 'device', // Use device icon for individual items, not the group header
        label: 'device-manager.deviceType.PREVIOUSLY_SEEN',
      });
    }

    return groups;
  }

  getDeviceTypeIcon(type: DeviceGroupType): string {
    switch (type) {
      case 'HMD':
        return 'hmd';
      case 'CONTROLLER':
        return 'controller';
      case 'TRACKER':
        return 'tracker';
      case 'LIGHTHOUSE':
        return 'lighthouse';
      case 'PREVIOUSLY_SEEN':
        return 'device';
      default:
        return 'device';
    }
  }

  getDeviceTypeIconForDevice(type: DMDeviceType): string {
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

  getDeviceTypeLabel(type: DeviceGroupType): string {
    return `device-manager.deviceType.${type}`;
  }

  getDeviceDisplayName(device: DMKnownDevice): string {
    return device.nickname || device.defaultName;
  }

  isDeviceObserved(deviceId: string): boolean {
    return this.observedDeviceIds.includes(deviceId);
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

  getDeviceTags(device: DMKnownDevice): DMDeviceTag[] {
    return this.deviceManager.getTagsForKnownDevice(device);
  }

  getDeviceBatteryInfo(device: DMKnownDevice): { level: number; isCharging: boolean } | null {
    const ovrDevice = this.getDeviceOVR(device);
    if (ovrDevice && ovrDevice.providesBatteryStatus) {
      return {
        level: Math.round(ovrDevice.battery * 100),
        isCharging: ovrDevice.isCharging || false,
      };
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

  getDeviceSerialNumber(device: DMKnownDevice): string | null {
    const ovrDevice = this.getDeviceOVR(device);
    if (ovrDevice && ovrDevice.serialNumber) {
      return ovrDevice.serialNumber;
    }
    return null;
  }

  async powerOffDevice(device: DMKnownDevice) {
    const ovrDevice = this.getDeviceOVR(device);
    const lighthouseDevice = this.getDeviceLighthouse(device);

    if (ovrDevice && ovrDevice.canPowerOff) {
      await this.lighthouseConsole.turnOffDevices([ovrDevice]);
    } else if (lighthouseDevice) {
      await this.lighthouse.setPowerState(lighthouseDevice, 'sleep');
    }
  }

  async powerOnDevice(device: DMKnownDevice) {
    const lighthouseDevice = this.getDeviceLighthouse(device);
    if (lighthouseDevice) {
      await this.lighthouse.setPowerState(lighthouseDevice, 'on');
    }
  }

  getDevicePowerState(device: DMKnownDevice): DevicePowerState {
    const ovrDevice = this.getDeviceOVR(device);
    const lighthouseDevice = this.getDeviceLighthouse(device);

    // Handle OVR devices (controllers, trackers, HMDs)
    if (ovrDevice) {
      if (ovrDevice.isTurningOff) return 'turning-off';
      if (ovrDevice.canPowerOff) return 'on';
      // If device can't be powered off, its power state is unknown/uncontrollable
      return 'unknown';
    }

    // Handle lighthouse devices
    if (lighthouseDevice) {
      if (this.lighthouse.deviceNeedsIdentifier(lighthouseDevice)) return 'attention';
      switch (lighthouseDevice.powerState) {
        case 'on':
          return 'on';
        case 'sleep':
        case 'standby':
          return 'off';
        case 'booting':
          return 'turning-on';
        default:
          return 'unknown';
      }
    }

    return 'unknown';
  }

  getDevicePowerTitle(device: DMKnownDevice): string {
    const powerState = this.getDevicePowerState(device);
    switch (powerState) {
      case 'on':
        return 'device-manager.actions.powerOff';
      case 'off':
        return 'device-manager.actions.powerOn';
      case 'turning-off':
        return 'device-manager.status.turningOff';
      case 'turning-on':
        return 'device-manager.status.turningOn';
      default:
        return '';
    }
  }

  canShowPowerButton(device: DMKnownDevice): boolean {
    const ovrDevice = this.getDeviceOVR(device);
    const lighthouseDevice = this.getDeviceLighthouse(device);

    // Handle OVR devices
    if (ovrDevice) {
      // HMDs never show power button
      if (ovrDevice.class === 'HMD') {
        return false;
      }

      // Controllers and Trackers only show power button if they can be powered off or are turning off
      if (ovrDevice.class === 'Controller' || ovrDevice.class === 'GenericTracker') {
        return ovrDevice.canPowerOff || ovrDevice.isTurningOff;
      }

      // For any other OVR device types, don't show power button
      return false;
    }

    // Handle lighthouse devices - they can always show power buttons
    if (lighthouseDevice) {
      return true;
    }

    // Unknown device type
    return false;
  }

  async handleDevicePowerAction(device: DMKnownDevice, action: DevicePowerAction) {
    const lighthouseDevice = this.getDeviceLighthouse(device);
    if (!lighthouseDevice) return;

    if (this.lighthouse.deviceNeedsIdentifier(lighthouseDevice)) {
      this.modalService
        .addModal<
          LighthouseV1IdWizardModalInputModel,
          LighthouseV1IdWizardModalOutputModel
        >(LighthouseV1IdWizardModalComponent, { device: lighthouseDevice }, { closeOnEscape: false })
        .subscribe();
      return;
    }

    // For lighthouse devices with unknown state, open the force state popover
    if (lighthouseDevice && lighthouseDevice.powerState === 'unknown') {
      this.rightClickDevicePowerButton(device);
      return;
    }

    if (action === 'power-off') {
      await this.powerOffDevice(device);
    } else if (action === 'power-on') {
      await this.powerOnDevice(device);
    }
  }

  async configureDevice(device: DMKnownDevice) {
    this.modalService
      .addModal<
        DeviceManagerConfigModalInputModel,
        DeviceManagerConfigModalOutputModel
      >(DeviceManagerConfigModalComponent, { device })
      .subscribe();
  }

  async forgetDevice(device: DMKnownDevice) {
    if (this.isDeviceObserved(device.id)) {
      return; // Cannot forget observed devices
    }

    const result = await this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'device-manager.forget.title',
        message: 'device-manager.forget.message',
        confirmButtonText: 'device-manager.forget.confirm',
      })
      .toPromise();

    if (result?.confirmed) {
      this.deviceManager.forgetKnownDevice(device);
    }
  }

  onTagFilterChange(option: SelectBoxItem | undefined) {
    this.selectedTagFilterOption = option;
    if (!option || option.id === 'all') {
      this.selectedTagFilter = null;
    } else {
      this.selectedTagFilter = option.id as string;
    }
  }

  // TrackBy functions
  trackDeviceGroupBy(index: number, group: DeviceGroup): string {
    return group.type;
  }

  trackDeviceBy(index: number, device: DMKnownDevice): string {
    return device.id;
  }

  trackTagBy(index: number, tag: DMDeviceTag): string {
    return tag.id;
  }

  trackColorBy(index: number, color: string): string {
    return color;
  }

  // Filter state methods
  get hasActiveFilters(): boolean {
    return this.hasActiveSearch || this.hasActiveTagFilter;
  }

  get hasActiveSearch(): boolean {
    return this.searchQuery.trim().length > 0;
  }

  get hasActiveTagFilter(): boolean {
    return this.selectedTagFilter !== null;
  }

  get emptyStateMessage(): string {
    if (this.hasActiveFilters) {
      return 'device-manager.empty.noDevicesMatchingSearch';
    } else {
      return 'device-manager.empty.noDevices';
    }
  }

  sanitizeIdForCSS(id: string): string {
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  getPowerButtonAnchorId(device: DMKnownDevice): string {
    return '--anchor-device-power-btn-dm-' + this.sanitizeIdForCSS(device.id);
  }

  rightClickDevicePowerButton(device: DMKnownDevice) {
    const lighthouseDevice = this.getDeviceLighthouse(device);
    if (lighthouseDevice && !this.lighthouse.deviceNeedsIdentifier(lighthouseDevice)) {
      this.selectedPopoverDevice = device;
      this.showLHStatePopover = !this.showLHStatePopover;
    }
  }

  onClickOutsideLHStatePopover($event: MouseEvent) {
    const targetId = ($event.target as HTMLElement).id;
    const deviceId = this.selectedPopoverDevice
      ? this.sanitizeIdForCSS(this.selectedPopoverDevice.id)
      : '';
    if (targetId === 'btn-power-dm-' + deviceId) return;
    this.showLHStatePopover = false;
    this.selectedPopoverDevice = null;
  }

  async onForceLHState(device: DMKnownDevice, state: LighthouseDevicePowerState) {
    this.showLHStatePopover = false;
    this.selectedPopoverDevice = null;

    const lighthouseDevice = this.getDeviceLighthouse(device);
    if (!lighthouseDevice) return;

    if (state === 'on' && lighthouseDevice.powerState === 'on') {
      const result = await firstValueFrom(
        this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
          ConfirmModalComponent,
          {
            title: 'comp.device-list.forceOnBootingWarning.title',
            message: 'comp.device-list.forceOnBootingWarning.message',
            confirmButtonText: 'comp.device-list.lhForceState.on',
          }
        )
      );
      if (!result || !result.confirmed) return;
    }

    await this.lighthouse.setPowerState(lighthouseDevice, state, true);
  }
}
