import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogFocusDirective } from '../../directives/dialog-focus.directive';
import { TranslocoModule } from '@jsverse/transloco';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FramePairingService } from '../../services/frame-pairing.service';
import { DeviceManagerService } from '../../services/device-manager.service';
import {
  FRAME_MANUAL_UNINSTALL_COMMAND,
  FrameAction,
  FrameError,
  frameError,
  frameStatus,
  frameStateError,
  removedPairing,
} from '../../models/frame-pairing';
import { ModalService } from '../../services/modal.service';
import { DeviceManagerConfigModalComponent } from '../device-manager-config-modal/device-manager-config-modal.component';

@Component({
  selector: 'app-frame-details',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslocoModule, RouterLink, DialogFocusDirective],
  templateUrl: './frame-details.component.html',
  styleUrl: './frame-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FrameDetailsComponent {
  @ViewChild('confirmation') confirmation!: ElementRef<HTMLDialogElement>;
  @ViewChild('heading') set heading(value: ElementRef<HTMLElement> | undefined) {
    if (value) queueMicrotask(() => value.nativeElement.isConnected && value.nativeElement.focus());
  }
  readonly state = computed(() =>
    this.pairing
      .states()
      .find((state) => state.pairing_id === this.route.snapshot.paramMap.get('pairingId'))
  );
  readonly status = computed(() => frameStatus(this.state()));
  readonly busy = computed(() => this.pending() || !!this.state()?.in_progress);
  readonly pending = signal(false);
  readonly expanded = signal(false);
  readonly error = signal<FrameError | null>(null);
  readonly failure = computed(() => this.error() ?? frameStateError(this.state()));
  readonly manualUninstallCommand = FRAME_MANUAL_UNINSTALL_COMMAND;
  readonly removal = signal<'unpair' | 'forget_local' | null>(null);
  readonly changingAddress = signal(false);
  readonly address = signal('');

  constructor(
    readonly pairing: FramePairingService,
    private route: ActivatedRoute,
    private router: Router,
    private devices: DeviceManagerService,
    private modals: ModalService
  ) {
    void pairing.init();
    effect(() => {
      const state = this.state();
      if (state && removedPairing(state)) {
        this.pairing.notice.set(state.remote_removal_performed ? 'unpaired' : 'forgotten');
        this.confirmation?.nativeElement.close();
        void this.router.navigate(['/dashboard/deviceManager']);
      }
    });
  }

  configure() {
    const state = this.state();
    const device = state && this.devices.getKnownDeviceById(state.device_manager_id);
    if (device) this.modals.addModal(DeviceManagerConfigModalComponent, { device }).subscribe();
  }

  openPairing() {
    const state = this.state();
    const device = state && this.devices.getKnownDeviceById(state.device_manager_id);
    if (device) void this.pairing.open(device);
  }

  confirm(action: 'unpair' | 'forget_local') {
    if (this.busy()) return;
    this.error.set(null);
    this.removal.set(action);
    this.confirmation.nativeElement.showModal();
  }

  closeConfirmation() {
    this.confirmation.nativeElement.close();
    this.removal.set(null);
  }

  async run(action: FrameAction, showGuide = false) {
    const state = this.state();
    if (!state || this.busy()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      await this.pairing.run(state, action);
      if (showGuide) this.openPairing();
    } catch (error) {
      this.error.set(frameError(error));
    } finally {
      this.pending.set(false);
    }
  }

  async reconnect() {
    const state = this.state();
    if (!state || this.busy() || !this.address().trim()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      const [candidate] = await this.pairing.discover(this.address());
      if (candidate) await this.pairing.reconnect(state, candidate);
      this.changingAddress.set(false);
    } catch (error) {
      this.error.set(frameError(error));
    } finally {
      this.pending.set(false);
    }
  }
}
