import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { ModalService } from 'src-ui/app/services/modal.service';
import { DeviceSelection, DMDeviceType } from 'src-ui/app/models/device-manager';
import { DeviceSelectorModalComponent } from '../device-selector-modal/device-selector-modal.component';
import { hshrink, noop } from '../../utils/animations';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { TranslateService } from '@ngx-translate/core';
import { isEqual } from 'lodash';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-device-selector',
  templateUrl: './device-selector.component.html',
  styleUrls: ['./device-selector.component.scss'],
  animations: [hshrink(), noop()],
  standalone: false,
})
export class DeviceSelectorComponent implements OnInit {
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
    private deviceManagerService: DeviceManagerService,
    private translateService: TranslateService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.deviceManagerService.knownDevices
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateDeviceCount();
      });
  }

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
      return this.translateService.instant('comp.device-selector.noSelection');
    }
    return this.translateService.instant('comp.device-selector.withDevices', {
      count: this.deviceCount,
    });
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
      this.deviceCount = devices.knownDevices.length;
    } catch (error) {
      console.error('Failed to get devices for selection:', error);
      this.deviceCount = 0;
    }
  }
}
