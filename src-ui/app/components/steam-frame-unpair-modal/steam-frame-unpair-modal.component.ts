import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { TranslocoModule } from '@jsverse/transloco';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { fadeUp } from '../../utils/animations';
import { SteamFramePairingService } from '../../services/steam-frame-pairing.service';
import { STEAM_FRAME_UNINSTALL_COMMAND, SteamFrameUnpairFailure } from '../../models/steam-frame';

export interface SteamFrameUnpairModalInputModel {
  deviceId: string;
  /** Opens at Forget on this PC, for a pairing the headset already removed. */
  removedOnHeadset?: boolean;
}

type UnpairPage = 'checking' | 'choose' | 'working' | 'failed' | 'forget';

/** The error code and the `unpair.failed` body key for each failure. */
const UNPAIR_FAILURES: Record<SteamFrameUnpairFailure, { code: string; body: string }> = {
  unreachable: { code: 'SF-421', body: 'body' },
  rejected: { code: 'SF-425', body: 'rejected' },
  hostKeyChanged: { code: 'SF-422', body: 'hostKeyChanged' },
  helperBusy: { code: 'SF-423', body: 'helperBusy' },
  failed: { code: 'SF-424', body: 'other' },
};

@Component({
  selector: 'app-steam-frame-unpair-modal',
  standalone: true,
  imports: [TranslocoModule],
  templateUrl: './steam-frame-unpair-modal.component.html',
  styleUrl: './steam-frame-unpair-modal.component.scss',
  animations: [fadeUp()],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SteamFrameUnpairModalComponent
  extends BaseModalComponent<SteamFrameUnpairModalInputModel, void>
  implements OnInit, SteamFrameUnpairModalInputModel
{
  deviceId!: string;
  removedOnHeadset?: boolean;

  private readonly framePairing = inject(SteamFramePairingService);
  readonly page = signal<UnpairPage>('checking');
  readonly otherPcs = signal(0);
  readonly uninstalling = signal(false);
  readonly copied = signal(false);
  readonly failure = signal(UNPAIR_FAILURES.failed);
  readonly uninstallCommand = STEAM_FRAME_UNINSTALL_COMMAND;
  /** Whether the last attempt uninstalled the helper, so Try again repeats it; unset before one. */
  private choice?: boolean;

  ngOnInit() {
    if (this.removedOnHeadset) this.page.set('forget');
    else void this.check();
  }

  async check() {
    const pairing = this.framePairing.pairingFor(this.deviceId);
    if (!pairing) return this.close();
    this.page.set('checking');
    const count = await this.framePairing.otherPcCount(pairing);
    if (typeof count !== 'number') return this.fail(count);
    this.otherPcs.set(count);
    this.page.set('choose');
  }

  async unpair(uninstall: boolean) {
    const pairing = this.framePairing.pairingFor(this.deviceId);
    if (!pairing) return this.close();
    this.choice = uninstall;
    this.uninstalling.set(uninstall);
    this.page.set('working');
    const failure = await this.framePairing.unpair(pairing, uninstall);
    if (!failure) return this.close();
    this.fail(failure);
  }

  private fail(failure: SteamFrameUnpairFailure) {
    this.failure.set(UNPAIR_FAILURES[failure]);
    this.page.set('failed');
  }

  tryAgain() {
    return this.choice === undefined ? this.check() : this.unpair(this.choice);
  }

  async forget() {
    const pairing = this.framePairing.pairingFor(this.deviceId);
    if (pairing) await this.framePairing.forget(pairing);
    this.close();
  }

  async copyCommand() {
    await navigator.clipboard.writeText(this.uninstallCommand);
    this.copied.set(true);
  }
}
