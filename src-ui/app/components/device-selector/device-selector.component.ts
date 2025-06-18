import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ModalService } from 'src-ui/app/services/modal.service';
import { DeviceSelection, DMDeviceType } from 'src-ui/app/models/device-manager';
import { DeviceSelectorModalComponent } from '../device-selector-modal/device-selector-modal.component';
import { hshrink, noop } from '../../utils/animations';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { isEqual } from 'lodash';

@Component({
  selector: 'app-device-selector',
  templateUrl: './device-selector.component.html',
  styleUrls: ['./device-selector.component.scss'],
  animations: [hshrink(), noop()],
  standalone: false,
})
export class DeviceSelectorComponent {
  private _selection?: DeviceSelection;
  private lastSelection?: DeviceSelection;

  @Input()
  set selection(value: DeviceSelection | undefined) {
    this._selection = value;
    this.checkSelectionChange();
  }
  get selection(): DeviceSelection | undefined {
    return this._selection;
  }

  @Input() allowedDeviceTypes?: DMDeviceType[];
  @Output() selectionChange = new EventEmitter<DeviceSelection>();

  protected deviceCount = 0;

  constructor(
    private modalService: ModalService,
    private deviceManagerService: DeviceManagerService
  ) {}

  get hasSelection(): boolean {
    return !!(
      this.selection &&
      (this.selection.devices.length > 0 ||
        this.selection.types.length > 0 ||
        this.selection.tagIds.length > 0)
    );
  }

  get buttonText(): string {
    if (!this.hasSelection) {
      return 'Select Devices';
    }
    return `${this.deviceCount} Device${this.deviceCount === 1 ? '' : 's'}`;
  }

  openModal() {
    this.modalService
      .addModal(
        DeviceSelectorModalComponent,
        {
          selection: structuredClone(this.selection),
          allowedDeviceTypes: this.allowedDeviceTypes,
        },
        {}
      )
      .subscribe((result) => {
        if (result && result.save) {
          this.selection = result.selection;
          this.selectionChange.emit(this.selection);
        }
      });
  }

  clearSelection() {
    this.selection = {
      devices: [],
      types: [],
      tagIds: [],
    };
    this.selectionChange.emit(this.selection);
  }

  private checkSelectionChange() {
    if (!isEqual(this.selection, this.lastSelection)) {
      this.lastSelection = this.selection ? structuredClone(this.selection) : undefined;
      this.updateDeviceCount();
    }
  }

  private async updateDeviceCount() {
    if (!this.selection) {
      this.deviceCount = 0;
      return;
    }

    try {
      const devices = await this.deviceManagerService.getDevicesForSelection(this.selection);
      this.deviceCount = devices.lighthouseDevices.length + devices.ovrDevices.length;
    } catch (error) {
      console.error('Failed to get devices for selection:', error);
      this.deviceCount = 0;
    }
  }
}
