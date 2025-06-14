import { Component, DestroyRef, OnInit } from '@angular/core';
import { DeviceManagerService } from '../../../../../../services/device-manager.service';
import { ModalService } from '../../../../../../services/modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../../../components/confirm-modal/confirm-modal.component';
import {
  DMKnownDevice,
  DMDeviceTag,
  DEVICE_MANAGER_TAG_COLORS,
} from '../../../../../../models/device-manager';
import { combineLatest } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fade, vshrink } from '../../../../../../utils/animations';

@Component({
  selector: 'app-device-manager-tags-tab',
  templateUrl: './device-manager-tags-tab.component.html',
  styleUrls: ['./device-manager-tags-tab.component.scss'],
  animations: [fade(), vshrink()],
  standalone: false,
})
export class DeviceManagerTagsTabComponent implements OnInit {
  knownDevices: DMKnownDevice[] = [];
  tags: DMDeviceTag[] = [];
  tagColors: string[] = [...DEVICE_MANAGER_TAG_COLORS];

  // Tag management
  newTagName = '';
  newTagColor: string = this.tagColors[0];
  editingTag: DMDeviceTag | null = null;

  constructor(
    private deviceManager: DeviceManagerService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    // Subscribe to device manager data
    combineLatest([this.deviceManager.knownDevices, this.deviceManager.tags])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([knownDevices, tags]) => {
        this.knownDevices = knownDevices;
        this.tags = tags;
      });
  }

  // TrackBy functions
  trackDeviceBy(index: number, device: DMKnownDevice): string {
    return device.id;
  }

  trackTagBy(index: number, tag: DMDeviceTag): string {
    return tag.id;
  }

  trackColorBy(index: number, color: string): string {
    return color;
  }

  // Tag management methods
  createTag() {
    if (!this.newTagName.trim()) return;

    this.deviceManager.createTag(this.newTagName, this.newTagColor);
    this.newTagName = '';
    this.newTagColor = this.tagColors[0];
  }

  editTag(tag: DMDeviceTag) {
    this.editingTag = { ...tag };
  }

  saveTag() {
    if (!this.editingTag || !this.editingTag.name.trim()) return;

    this.deviceManager.updateTag(this.editingTag.id, this.editingTag.name, this.editingTag.color);
    this.editingTag = null;
  }

  cancelEditTag() {
    this.editingTag = null;
  }

  async deleteTag(tag: DMDeviceTag) {
    const result = await this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'device-manager.deleteTag.title',
        message: 'device-manager.deleteTag.message',
        confirmButtonText: 'device-manager.deleteTag.confirm',
      })
      .toPromise();

    if (result?.confirmed) {
      this.deviceManager.deleteTag(tag.id);
    }
  }
}
