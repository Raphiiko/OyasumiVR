import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from '../../utils/animations';
import { DMKnownDevice, DMDeviceTag } from '../../models/device-manager';
import { DeviceManagerService } from '../../services/device-manager.service';

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

  constructor(private deviceManager: DeviceManagerService) {
    super();
  }

  ngOnInit(): void {
    this.nickname = this.device.nickname || '';
    this.loadTags();
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
}
