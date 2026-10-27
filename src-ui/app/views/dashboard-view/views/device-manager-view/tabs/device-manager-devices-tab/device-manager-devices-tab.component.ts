import { Router } from '@angular/router';
import {
  ChangeDetectorRef,
  Component,
  OnInit,
  AfterViewInit,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DeviceManagerService } from '../../../../../../services/device-manager.service';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { LighthouseService } from '../../../../../../services/lighthouse.service';
import { ModalService } from '../../../../../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../../../components/confirm-modal/confirm-modal.component';
import { DMKnownDevice, DMDeviceType, DMDeviceTag } from '../../../../../../models/device-manager';
import { LighthouseDevicePowerState } from '../../../../../../models/lighthouse-device';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DevicePowerAction } from '../../../../../../components/device-power-button/device-power-button.component';
import { fade, vshrink } from '../../../../../../utils/animations';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { DomSanitizer } from '@angular/platform-browser';
import Fuse, { IFuseOptions } from 'fuse.js';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { KnownDeviceActionsService } from 'src-ui/app/services/known-device-actions.service';
import { SteamFrameDeviceService } from 'src-ui/app/services/steam-frame/steam-frame-device.service';

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DeviceManagerDevicesTabComponent implements OnInit, AfterViewInit {
  knownDevices: DMKnownDevice[] = [];
  observedDeviceIds: string[] = [];
  tags: DMDeviceTag[] = [];

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
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef,
    private steamFrame: SteamFrameService,
    private router: Router,
    protected devices: KnownDeviceActionsService,
    protected frames: SteamFrameDeviceService
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
      .subscribe(([knownDevices, observedDeviceIds, tags]) => {
        this.knownDevices = knownDevices;
        this.observedDeviceIds = observedDeviceIds;
        this.tags = tags;

        // Initialize Fuse.js with updated devices
        this.initializeFuse();
        this.cdr.markForCheck();
      });

    // Initialize tag filter to "All tags"
    this.updateTagFilterOptions();
    this.selectedTagFilterOption = this._tagFilterOptions[0];
  }

  ngAfterViewInit() {
    // Watch for tag changes to update filter options
    this.deviceManager.tags.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.updateTagFilterOptions();
      this.cdr.markForCheck();
    });
  }

  private updateTagFilterOptions() {
    this._tagFilterOptions = [
      {
        id: 'all',
        label: 'device-manager.filter.allTags',
        htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
          '<svg class="svg-icon" style="margin-right: 0.5em;"><use href="/assets/icons/filter.svg#icon"/></svg>'
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
    const fuseOptions: IFuseOptions<DMKnownDevice> = {
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
        return 'headset';
      case 'CONTROLLER':
        return 'controller';
      case 'TRACKER':
        return 'tracker';
      case 'LIGHTHOUSE':
        return 'base-station';
      case 'PREVIOUSLY_SEEN':
        return 'device';
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

  getDeviceTags(device: DMKnownDevice): DMDeviceTag[] {
    return this.deviceManager.getTagsForKnownDevice(device);
  }

  async handleDevicePowerAction(device: DMKnownDevice, action: DevicePowerAction) {
    if ((await this.devices.handlePowerAction(device, action)) === 'chooseState') {
      this.rightClickDevicePowerButton(device);
    }
  }

  openDevice(device: DMKnownDevice) {
    void this.router.navigate(['/dashboard/deviceManager/device', device.id]);
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
      // the core keeps connecting to a Frame until its pairing is gone
      const pairing = this.steamFrame.pairingFor(device.id);
      if (pairing) await this.steamFrame.removePairing(pairing.deviceId);
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
    const lighthouseDevice = this.devices.lighthouseFor(device);
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
    await this.devices.forceLighthouseState(device, state);
  }
}
