import { ChangeDetectorRef, Component, ElementRef, OnDestroy, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { DMDeviceTag, DMKnownDevice } from '../../../../../models/device-manager';
import { LighthouseDevicePowerState } from '../../../../../models/lighthouse-device';
import { DeviceManagerService } from '../../../../../services/device-manager.service';
import { OpenVRService } from '../../../../../services/openvr.service';
import { LighthouseService } from '../../../../../services/lighthouse.service';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import {
  FramePill,
  SteamFrameDeviceViewService,
} from 'src-ui/app/views/dashboard-view/views/device-manager-view/steam-frame-device-view.service';
import { KnownDeviceViewService } from 'src-ui/app/views/dashboard-view/views/device-manager-view/known-device-view.service';
import { SegmentedControlItem } from '../../../../../components/segmented-control/segmented-control.component';

interface HeaderPill {
  key: string;
  tone: 'good' | 'neutral' | 'warn' | 'bad';
  params?: Record<string, string>;
  /** Set when a click explains the pill or starts its action. */
  framePill?: FramePill;
}

interface Fact {
  label: string;
  value: string;
}

@Component({
  selector: 'app-device-detail-view',
  templateUrl: './device-detail-view.component.html',
  styleUrls: ['./device-detail-view.component.scss'],
  standalone: false,
})
export class DeviceDetailViewComponent implements OnDestroy {
  device?: DMKnownDevice;
  tags: DMDeviceTag[] = [];
  /** The name being typed while the header name is in edit mode, else null. */
  nameDraft: string | null = null;
  lighthousePowerOffState: LighthouseDevicePowerState = 'sleep';
  tab: 'general' | 'frame' = 'general';

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly powerOffStates: SegmentedControlItem<LighthouseDevicePowerState>[] = [
    { id: 'sleep', label: 'settings.general.lighthousePowerControl.powerOffMode.sleep.title' },
    { id: 'standby', label: 'settings.general.lighthousePowerControl.powerOffMode.standby.title' },
  ];

  constructor(
    route: ActivatedRoute,
    openvr: OpenVRService,
    private router: Router,
    private deviceManager: DeviceManagerService,
    private lighthouse: LighthouseService,
    private appSettings: AppSettingsService,
    protected frames: SteamFrameDeviceViewService,
    private cdr: ChangeDetectorRef,
    protected devices: KnownDeviceViewService
  ) {
    combineLatest([
      route.paramMap.pipe(map((params) => params.get('id'))),
      deviceManager.knownDevices,
      deviceManager.observedDevices,
      deviceManager.tags,
      openvr.devices,
      lighthouse.devices,
      appSettings.settings,
    ])
      .pipe(takeUntilDestroyed())
      .subscribe(([id, knownDevices, , tags, , , settings]) =>
        this.onData(id, knownDevices, tags, settings.lighthousePowerOffState)
      );
  }

  ngOnDestroy() {
    this.saveName();
  }

  private onData(
    id: string | null,
    knownDevices: DMKnownDevice[],
    tags: DMDeviceTag[],
    powerOffState: LighthouseDevicePowerState
  ) {
    const device = knownDevices.find((d) => d.id === id);
    if (!device) {
      // the known devices load after startup, so only a device that was shown can have gone
      if (this.device?.id === id) this.back();
      return;
    }

    // a route change to another device starts its page fresh
    if (device.id !== this.device?.id) {
      this.saveName();
      this.tab = 'general';
    }

    this.device = device;
    this.tags = tags;
    this.lighthousePowerOffState = powerOffState;
    this.cdr.markForCheck();
  }

  get displayName(): string {
    return this.device ? this.device.nickname || this.device.defaultName : '';
  }

  back() {
    void this.router.navigate(['/dashboard/deviceManager']);
  }

  openTags() {
    void this.router.navigate(['/dashboard/deviceManager'], { queryParams: { tab: 'tags' } });
  }

  startRename() {
    this.nameDraft = this.displayName;
    // the input renders on the next change detection
    setTimeout(() => this.nameInput()?.nativeElement.select());
  }

  /** Stores the typed name; an empty name or the original name clears the nickname. */
  saveName() {
    if (this.nameDraft === null || !this.device) return;
    const name = this.nameDraft.trim();
    // the save emits knownDevices synchronously and re-enters onData, so the draft goes first
    this.nameDraft = null;
    const nickname = name === this.device.defaultName ? '' : name;
    if (nickname === (this.device.nickname ?? '')) return;
    this.device = this.deviceManager.setNicknameForKnownDevice(this.device, nickname);
  }

  cancelRename() {
    this.nameDraft = null;
  }

  isTagAssigned(tag: DMDeviceTag): boolean {
    return !!this.device?.tagIds.includes(tag.id);
  }

  toggleTag(tag: DMDeviceTag) {
    if (!this.device) return;
    this.device = this.isTagAssigned(tag)
      ? this.deviceManager.removeTagFromKnownDevice(this.device, tag)
      : this.deviceManager.addTagToKnownDevice(this.device, tag);
  }

  toggleDisabled() {
    if (!this.device) return;
    this.device = this.deviceManager.disableKnownDevice(this.device, !this.device.disabled);
  }

  assignedTags(): DMDeviceTag[] {
    return this.device ? this.deviceManager.getTagsForKnownDevice(this.device) : [];
  }

  /** The state the header names, or null when the rest of the header already shows it. */
  headerPill(): HeaderPill | null {
    const device = this.device!;
    const row = this.frames.row(device);
    if (row?.badge)
      return {
        key: `steamFrame.status.${row.badge}`,
        tone: row.badge === 'connected' ? 'good' : 'neutral',
      };
    if (row?.pill) {
      return {
        key: `steamFrame.status.${row.pill.key}`,
        tone: row.pill.tone,
        params: row.pill.params,
        framePill: row.pill.detail || row.pill.startsUpdate ? row.pill : undefined,
      };
    }
    if (!this.devices.isObserved(device))
      return { key: 'device-manager.detail.notConnected', tone: 'neutral' };
    return null;
  }

  onHeaderPill(pill: FramePill) {
    const device = this.device!;
    this.frames.onPill(device, pill, this.frames.row(device)?.action);
  }

  setPowerOffState(state: LighthouseDevicePowerState) {
    this.appSettings.updateSettings({ lighthousePowerOffState: state });
  }

  /** 'NONE' for anything but a V1 base station that is in range. */
  v1IdentifierMode(): 'NONE' | 'NEEDS_ID' | 'HAS_ID' {
    const lighthouseDevice = this.devices.lighthouseFor(this.device!);
    if (lighthouseDevice?.deviceType !== 'lighthouseV1') return 'NONE';
    return this.lighthouse.deviceNeedsIdentifier(lighthouseDevice) ? 'NEEDS_ID' : 'HAS_ID';
  }

  openV1IdWizard() {
    const lighthouseDevice = this.devices.lighthouseFor(this.device!);
    if (lighthouseDevice) void this.devices.openLighthouseV1IdWizard(lighthouseDevice);
  }

  facts(): Fact[] {
    const device = this.device!;
    const ovrDevice = this.devices.ovrFor(device);
    const facts: Fact[] = [];
    const add = (label: string, value?: string | null) => {
      if (value) facts.push({ label: `device-manager.detail.facts.${label}`, value });
    };

    add('manufacturer', device.manufacturer);
    add('model', device.typeName);
    // a base station's stored default name is its serial, so it still shows while offline
    const storedSerial = device.deviceType === 'LIGHTHOUSE' ? device.defaultName : null;
    add('serialNumber', this.devices.serialOf(device) ?? storedSerial);
    add('hardwareRevision', ovrDevice?.hardwareRevision);
    add('dongleId', ovrDevice?.dongleId);
    if (device.deviceType === 'LIGHTHOUSE') {
      add('bluetoothAddress', this.deviceManager.getLighthouseIdForKnownDevice(device));
    }
    const frame = this.frames.details(device);
    add('address', frame?.paired ? frame.state?.address : null);
    return facts;
  }
}
