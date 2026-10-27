import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { DMDeviceTag, DMKnownDevice } from '../../../../../models/device-manager';
import { LighthouseDevicePowerState } from '../../../../../models/lighthouse-device';
import { SteamFrameConnectionStatus } from '../../../../../models/steam-frame';
import { DeviceManagerService } from '../../../../../services/device-manager.service';
import { OpenVRService } from '../../../../../services/openvr.service';
import { LighthouseService } from '../../../../../services/lighthouse.service';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { ModalService } from '../../../../../services/modal.service';
import { SteamFrameService } from '../../../../../services/steam-frame/steam-frame.service';
import {
  FramePill,
  KnownDeviceActionsService,
} from '../../../../../services/known-device-actions.service';
import { SegmentedControlItem } from '../../../../../components/segmented-control/segmented-control.component';

/** Statuses whose connection loop still runs an update the user requests. */
const UPDATABLE_STATUSES: SteamFrameConnectionStatus[] = [
  'connecting',
  'connected',
  'offline',
  'helperOutdated',
];

const UNREPAIRABLE_STATUSES: (SteamFrameConnectionStatus | undefined)[] = [
  'hostKeyChanged',
  'pairingRemoved',
  'needsAppUpdate',
];

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
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  readonly forceStates = [
    { state: 'on', icon: 'power', label: 'comp.device-list.lhForceState.on' },
    { state: 'standby', icon: 'standby', label: 'comp.device-list.lhForceState.standby' },
    { state: 'sleep', icon: 'sleep', label: 'comp.device-list.lhForceState.sleep' },
  ] as const;

  constructor(
    route: ActivatedRoute,
    openvr: OpenVRService,
    private router: Router,
    private deviceManager: DeviceManagerService,
    private lighthouse: LighthouseService,
    private appSettings: AppSettingsService,
    private modalService: ModalService,
    private steamFrame: SteamFrameService,
    private cdr: ChangeDetectorRef,
    destroyRef: DestroyRef,
    protected devices: KnownDeviceActionsService
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
      .pipe(takeUntilDestroyed(destroyRef))
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
    const row = this.devices.frameRow(device);
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
    this.devices.onFramePill(device, pill, this.devices.frameRow(device)?.action);
  }

  /** The base station's settled power state, or null while it changes or is unknown. */
  lighthouseState(): LighthouseDevicePowerState | null {
    const lighthouseDevice = this.devices.lighthouseFor(this.device!);
    if (!lighthouseDevice || lighthouseDevice.transitioningToPowerState) return null;
    return lighthouseDevice.powerState;
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
    add('serialNumber', this.devices.serialOf(device));
    add('hardwareRevision', ovrDevice?.hardwareRevision);
    add('dongleId', ovrDevice?.dongleId);
    if (device.deviceType === 'LIGHTHOUSE') {
      add('bluetoothAddress', this.deviceManager.getLighthouseIdForKnownDevice(device));
    }
    add('address', this.frame()?.state?.address);
    return facts;
  }

  /** The Steam Frame pairing and connection, or null for any other device. */
  frame() {
    const device = this.device!;
    if (!this.steamFrame.identityOf(device)) return null;
    const pairing = this.steamFrame.pairingFor(device.id);
    const state = pairing?.complete ? this.steamFrame.connections()[pairing.id] : undefined;
    const action = this.devices.frameRow(device)?.action;
    if (!pairing?.complete) return { paired: false as const, canPair: action === 'pair' };

    const removedOnHeadset = state?.status === 'pairingRemoved';
    const maintenance = state?.maintenance?.kind;
    return {
      paired: true as const,
      pairing,
      state,
      version: state?.helperVersion ?? pairing.helperVersion,
      updating: maintenance === 'updating',
      canUpdate:
        !!state &&
        UPDATABLE_STATUSES.includes(state.status) &&
        (state.updateAvailable || maintenance === 'failed'),
      // only a helper that answers can be called up to date
      upToDate: state?.status === 'connected' && !state.updateAvailable,
      repairing: !!this.steamFrame.reinstalls()[pairing.id],
      // a repair needs SSH access
      canRepair: !UNREPAIRABLE_STATUSES.includes(state?.status),
      // a headset that no longer knows this PC offers pairing while SteamVR uses it
      pairAgain: action === 'pairAgain' || (removedOnHeadset && action === 'pair'),
      removedOnHeadset,
    };
  }

  pairFrame() {
    void this.devices.onFrameAction(this.device!, 'pair');
  }

  updateFrameHelper() {
    const frame = this.frame();
    if (frame?.paired) void this.steamFrame.updateHelper(frame.pairing);
  }

  repairFrameHelper() {
    const frame = this.frame();
    if (frame?.paired) void this.steamFrame.reinstallHelper(frame.pairing, true);
  }

  async unpairFrame() {
    const frame = this.frame();
    if (!frame?.paired) return;
    const { SteamFrameUnpairModalComponent } =
      await import('../../../../../components/steam-frame/steam-frame-unpair-modal/steam-frame-unpair-modal.component');
    // an unpair keeps running after the dialog closes, so Escape must not look like a cancel
    this.modalService
      .addModal(
        SteamFrameUnpairModalComponent,
        { deviceId: this.device!.id, removedOnHeadset: frame.removedOnHeadset },
        { closeOnEscape: false }
      )
      .subscribe();
  }
}
