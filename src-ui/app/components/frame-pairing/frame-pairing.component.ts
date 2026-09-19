import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogFocusDirective } from '../../directives/dialog-focus.directive';
import { WindowTitlebarComponent } from '../window-titlebar/window-titlebar.component';
import { TranslocoModule } from '@jsverse/transloco';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { DMKnownDevice } from '../../models/device-manager';
import {
  FrameAction,
  FrameCandidate,
  FrameError,
  FrameState,
  frameError,
  frameStateError,
} from '../../models/frame-pairing';
import { FramePairingService } from '../../services/frame-pairing.service';

export type PairingPage =
  | 'intro'
  | 'devmode'
  | 'pairhost'
  | 'search'
  | 'found'
  | 'notfound'
  | 'manual'
  | 'notready'
  | 'request'
  | 'awaiting'
  | 'declined'
  | 'timeout'
  | 'setup'
  | 'setupFailed'
  | 'cancelling'
  | 'cleanupFailed'
  | 'cancelled'
  | 'success'
  | 'accessLost'
  | 'error';

export function pairingPage(state: FrameState, cancelling: boolean): PairingPage {
  const error = frameStateError(state);
  if (
    cancelling ||
    state.cancelling ||
    state.action === 'cleanup' ||
    state.step === 'finishing_cleanup'
  ) {
    if (state.in_progress) return 'cancelling';
    return state.cleanup_pending || (state.error && state.error !== 'cancelled')
      ? 'cleanupFailed'
      : 'cancelled';
  }
  if (
    error &&
    [
      'host_key_changed',
      'certificate_changed',
      'wrong_device',
      'identity_unverified',
      'protocol_mismatch',
      'companion_authentication_failed',
    ].includes(error)
  )
    return 'error';
  if (!state.in_progress && error === 'authentication_failed') return 'accessLost';
  if (!state.in_progress && state.cleanup_pending) return 'cleanupFailed';
  if (state.step === 'cancelled') return state.cleanup_pending ? 'cleanupFailed' : 'cancelled';
  if (state.step === 'failed' || (state.step === 'offline' && !state.paired)) {
    if (state.cleanup_pending) return 'cleanupFailed';
    if (state.error === 'not_armed') return 'notready';
    if (state.error === 'denied') return 'declined';
    if (state.error === 'timeout') return 'timeout';
    if (state.access_verified) return 'setupFailed';
    return 'error';
  }
  if (state.step === 'awaiting_approval') return 'awaiting';
  if (state.step === 'verifying_ssh') return state.action === 'pair' ? 'request' : 'setup';
  if (['verifying_identity', 'installing', 'verifying_companion'].includes(state.step))
    return 'setup';
  if (state.paired && !state.in_progress && !state.repair_needed) return 'success';
  if (state.step === 'connected') return 'setup';
  if (state.step === 'repair_needed') return 'error';
  return 'intro';
}

@Component({
  selector: 'app-frame-pairing',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TranslocoModule,
    WindowTitlebarComponent,
    DialogFocusDirective,
  ],
  templateUrl: './frame-pairing.component.html',
  styleUrl: './frame-pairing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FramePairingComponent
  extends BaseModalComponent<{ device: DMKnownDevice }, void>
  implements AfterViewInit, OnDestroy
{
  device!: DMKnownDevice;
  @ViewChild('dialog') dialog!: ElementRef<HTMLDialogElement>;
  @ViewChild('heading') heading!: ElementRef<HTMLElement>;
  readonly page = signal<PairingPage>('intro');
  protected readonly Math = Math;
  readonly state = signal<FrameState | undefined>(undefined);
  readonly candidates = signal<FrameCandidate[]>([]);
  readonly selected = signal(0);
  readonly pending = signal(false);
  readonly cancelling = signal(false);
  readonly error = signal<FrameError | null>(null);
  readonly address = signal('');
  readonly repair = signal(false);
  readonly stepLabels = [
    'before',
    'developer',
    'pairhost',
    'find',
    'approve',
    'install',
    'finished',
  ];
  readonly stageLabels = ['verify', 'install', 'connection'];
  private generation = 0;
  private destroyed = false;
  private revision = -1;
  private backendPage?: PairingPage;
  private pairingId?: string;
  private previousPage: PairingPage = 'pairhost';

  readonly busy = computed(() => this.pending() || !!this.state()?.in_progress);
  readonly step = computed(() => {
    const page = this.page();
    if (page === 'intro') return 0;
    if (page === 'devmode') return 1;
    if (page === 'pairhost') return 2;
    if (['search', 'found', 'notfound', 'manual', 'notready'].includes(page)) return 3;
    if (['request', 'awaiting', 'declined', 'timeout'].includes(page)) return 4;
    if (page === 'success') return 6;
    if (['cancelled', 'cancelling', 'cleanupFailed', 'error', 'accessLost'].includes(page))
      return this.state()?.access_verified ? 5 : 4;
    return 5;
  });
  readonly illustration = computed(() => {
    switch (this.page()) {
      case 'devmode':
      case 'pairhost':
        return 'settings';
      case 'search':
        return 'searching';
      case 'found':
      case 'request':
        return 'devices';
      case 'notfound':
        return 'not-found';
      case 'awaiting':
        return 'approval-pending';
      case 'declined':
      case 'timeout':
        return 'request-stopped';
      case 'setup':
        return 'setup-running';
      case 'setupFailed':
        return 'setup-interrupted';
      case 'success':
        return 'paired';
      default:
        return '';
    }
  });
  readonly canBack = computed(
    () =>
      !this.busy() &&
      ['devmode', 'pairhost', 'found', 'notfound', 'manual', 'notready'].includes(this.page())
  );
  readonly validAddress = computed(() => {
    const value = this.address().trim();
    return value.length > 0 && value.length <= 253 && !/[\s/@\\?#]/.test(value);
  });

  constructor(readonly pairing: FramePairingService) {
    super();
    effect(() => {
      const states = this.pairing.states();
      if (!this.device) return;
      const state = this.pairingId
        ? states.find((item) => item.pairing_id === this.pairingId)
        : this.pairing.forDevice(this.device.id);
      if (!state || state.revision === this.revision) return;
      this.pairingId = state.pairing_id;
      this.revision = state.revision;
      this.state.set(state);
      this.repair.set(state.action === 'repair');
      const page = pairingPage(state, false);
      if (page !== this.backendPage) {
        this.backendPage = page;
        this.error.set(frameStateError(state));
        this.page.set(page);
      } else if (this.page() === page) {
        this.error.set(frameStateError(state));
      }
    });
    effect(() => {
      const page = this.page();
      queueMicrotask(() => {
        if (!this.destroyed)
          this.dialog?.nativeElement
            .querySelector<HTMLElement>(page === 'manual' ? '#frame-address' : 'h1')
            ?.focus();
      });
    });
  }

  ngAfterViewInit() {
    this.dialog.nativeElement.showModal();
    this.heading.nativeElement.focus();
  }

  go(page: PairingPage) {
    if (this.busy()) return;
    this.generation++;
    this.page.set(page);
    this.error.set(null);
  }

  back() {
    if (!this.canBack()) return;
    this.go(
      this.page() === 'devmode'
        ? 'intro'
        : this.page() === 'pairhost'
          ? 'devmode'
          : this.page() === 'manual'
            ? this.previousPage
            : 'pairhost'
    );
  }

  manual() {
    if (this.busy()) return;
    this.previousPage = this.page() === 'search' ? 'pairhost' : this.page();
    this.go('manual');
  }

  async discover(manual = false) {
    if (this.busy() || (manual && !this.validAddress())) return;
    const generation = ++this.generation;
    this.page.set('search');
    this.error.set(null);
    try {
      const candidates = await this.pairing.discover(manual ? this.address() : undefined);
      if (this.destroyed || generation !== this.generation) return;
      this.candidates.set(candidates);
      this.selected.set(0);
      this.page.set(candidates.length ? 'found' : 'notfound');
    } catch (error) {
      if (this.destroyed || generation !== this.generation) return;
      this.error.set(frameError(error));
      this.page.set(manual ? 'manual' : 'notfound');
    }
  }

  async pair() {
    const candidate = this.candidates()[this.selected()];
    if (!candidate) return;
    await this.perform(() => this.pairing.selectAndPair(this.device, candidate));
  }

  async run(action: FrameAction) {
    const state = this.state();
    if (!state) return;
    await this.perform(() => this.pairing.run(state, action));
  }

  private async perform(operation: () => Promise<unknown>) {
    if (this.busy()) return;
    this.pending.set(true);
    this.error.set(null);
    try {
      await operation();
    } catch (error) {
      this.error.set(frameError(error));
      this.page.set('error');
    } finally {
      this.pending.set(false);
    }
  }

  async cancelPairing() {
    if (this.pending() || this.cancelling()) return;
    const state = this.state();
    if (!state?.in_progress) {
      this.close();
      return;
    }
    this.cancelling.set(true);
    this.page.set('cancelling');
    try {
      await this.pairing.cancel(state);
      const current = this.pairing.forDevice(this.device.id);
      if (current) this.page.set(pairingPage(current, false));
    } catch (error) {
      this.error.set(frameError(error));
      this.cancelling.set(false);
      this.page.set('error');
    } finally {
      this.cancelling.set(false);
    }
  }

  override close() {
    this.generation++;
    this.dialog?.nativeElement.close();
    super.close();
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.generation++;
    this.dialog?.nativeElement.close();
  }
}
