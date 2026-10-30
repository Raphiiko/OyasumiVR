import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  effect,
  input,
  model,
  untracked,
} from '@angular/core';
import { ModalService } from 'src-ui/app/services/modal.service';
import { DeviceSelection, DMDeviceType } from 'src-ui/app/models/device-manager';
import { DeviceSelectorModalComponent } from '../device-selector-modal/device-selector-modal.component';
import { hshrink, noop } from '../../utils/animations';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { TranslocoService } from '@jsverse/transloco';
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
  private lastSelection?: DeviceSelection;

  readonly selection = model.required<DeviceSelection>();
  readonly allowedDeviceTypes = input<DMDeviceType[]>();

  protected deviceCount = 0;

  constructor(
    private modalService: ModalService,
    private deviceManagerService: DeviceManagerService,
    private translateService: TranslocoService,
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {
    effect(() => {
      this.selection();
      untracked(() => this.checkSelectionChange());
    });
  }

  ngOnInit() {
    this.deviceManagerService.knownDevices
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.updateDeviceCount();
      });
    // buttonText is translated on read, so the view has to be rechecked when the
    // active language changes.
    this.translateService.langChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.cdr.markForCheck());
  }

  get hasSelection(): boolean {
    const selection = this.selection();
    return !!(
      selection &&
      (selection.devices.length > 0 || selection.types.length > 0 || selection.tagIds.length > 0)
    );
  }

  get buttonText(): string {
    if (!this.hasSelection) {
      return this.translateService.translate('comp.device-selector.noSelection');
    }
    return this.translateService.translate('comp.device-selector.withDevices', {
      count: this.deviceCount,
    });
  }

  openModal() {
    this.modalService
      .addModal(
        DeviceSelectorModalComponent,
        {
          selection: structuredClone(this.selection()),
          allowedDeviceTypes: this.allowedDeviceTypes(),
        },
        {}
      )
      .subscribe((result) => {
        if (result && result.save) {
          this.selection.set(result.selection);
        }
      });
  }

  clearSelection() {
    this.selection.set({
      devices: [],
      types: [],
      tagIds: [],
    });
  }

  private checkSelectionChange() {
    const selection = this.selection();
    if (!isEqual(selection, this.lastSelection)) {
      this.lastSelection = selection ? structuredClone(selection) : undefined;
      this.updateDeviceCount();
    }
  }

  private async updateDeviceCount() {
    const selection = this.selection();
    if (!selection) {
      this.deviceCount = 0;
      this.cdr.markForCheck();
      return;
    }

    try {
      const devices = await this.deviceManagerService.getDevicesForSelection(selection);
      this.deviceCount = devices.knownDevices.length;
    } catch (error) {
      console.error('Failed to get devices for selection:', error);
      this.deviceCount = 0;
    }
    this.cdr.markForCheck();
  }
}
