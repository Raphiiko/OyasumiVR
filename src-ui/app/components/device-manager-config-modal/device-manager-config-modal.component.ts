import { Component, DestroyRef, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from '../../utils/animations';
import { DMKnownDevice, DMDeviceTag } from '../../models/device-manager';
import { DeviceManagerService } from '../../services/device-manager.service';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { firstValueFrom, map, Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ModalService } from 'src-ui/app/services/modal.service';
import {
  LighthouseV1IdWizardModalComponent,
  LighthouseV1IdWizardModalInputModel,
  LighthouseV1IdWizardModalOutputModel,
} from '../lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';

export interface DeviceManagerConfigModalInputModel {
  device: DMKnownDevice;
}

export interface DeviceManagerConfigModalOutputModel {
  // Nothing needed for output
}

@Component({
  selector: 'app-device-manager-config-modal',
  templateUrl: './device-manager-config-modal.component.html',
  styleUrls: ['./device-manager-config-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class DeviceManagerConfigModalComponent
  extends BaseModalComponent<
    DeviceManagerConfigModalInputModel,
    DeviceManagerConfigModalOutputModel
  >
  implements OnInit, DeviceManagerConfigModalInputModel
{
  device!: DMKnownDevice;
  nickname = '';
  availableTags: DMDeviceTag[] = [];

  v1LighthouseMode: 'NONE' | 'NEEDS_ID' | 'HAS_ID' = 'NONE';

  constructor(
    protected lighthouseService: LighthouseService,
    private deviceManager: DeviceManagerService,
    private destroyRef: DestroyRef,
    private modalService: ModalService
  ) {
    super();
  }

  ngOnInit(): void {
    this.nickname = this.device.nickname || '';
    this.loadTags();
    this.evaluateV1LighthouseMode();
  }

  private loadTags() {
    this.deviceManager.tags.subscribe((tags) => {
      this.availableTags = tags;
    });
  }

  getDisplayName(): string {
    return this.device.nickname || this.device.defaultName;
  }

  isTagAssigned(tag: DMDeviceTag): boolean {
    return this.device.tagIds.includes(tag.id);
  }

  toggleTag(tag: DMDeviceTag) {
    if (this.isTagAssigned(tag)) {
      this.device = this.deviceManager.removeTagFromKnownDevice(this.device, tag);
    } else {
      this.device = this.deviceManager.addTagToKnownDevice(this.device, tag);
    }
  }

  saveNickname() {
    this.device = this.deviceManager.setNicknameForKnownDevice(this.device, this.nickname);
  }

  clearNickname() {
    this.nickname = '';
  }

  close() {
    this.saveNickname();
    super.close();
  }

  // TrackBy functions
  trackTagBy(index: number, tag: DMDeviceTag): string {
    return tag.id;
  }

  private lighthouseEvaluationSub?: Subscription;

  evaluateV1LighthouseMode() {
    if (this.device.deviceType !== 'LIGHTHOUSE') {
      this.v1LighthouseMode = 'NONE';
      return;
    }
    const lighthouseId = this.deviceManager.getLighthouseIdForKnownDevice(this.device);
    this.lighthouseEvaluationSub?.unsubscribe();
    this.lighthouseEvaluationSub = this.lighthouseService.devices
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((devices) => devices.find((d) => d.id === lighthouseId))
      )
      .subscribe((device) => {
        if (!device || device.deviceType !== 'lighthouseV1') this.v1LighthouseMode = 'NONE';
        else
          this.v1LighthouseMode = this.lighthouseService.deviceNeedsIdentifier(device)
            ? 'NEEDS_ID'
            : 'HAS_ID';
      });
  }

  async openLighthouseV1IdWizard() {
    const lighthouseId = this.deviceManager.getLighthouseIdForKnownDevice(this.device);
    const device = await firstValueFrom(this.lighthouseService.devices).then((devices) =>
      devices.find((d) => d.id === lighthouseId)
    );
    if (!device) return;
    await firstValueFrom(
      this.modalService.addModal<
        LighthouseV1IdWizardModalInputModel,
        LighthouseV1IdWizardModalOutputModel
      >(
        LighthouseV1IdWizardModalComponent,
        {
          device,
        },
        {
          closeOnEscape: false,
        }
      )
    );
    this.evaluateV1LighthouseMode();
  }
}
