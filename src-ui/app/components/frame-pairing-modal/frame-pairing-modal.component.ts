import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TranslocoModule } from '@jsverse/transloco';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { FramePairingService } from '../../services/frame-pairing.service';
import { FramePage, FrameSetupStage } from '../../models/frame';

const STEP_OF_PAGE: Record<FramePage, number> = {
  intro: 0,
  devmode: 1,
  pairhost: 2,
  search: 3,
  found: 3,
  notfound: 3,
  manual: 3,
  notready: 3,
  wrongDevice: 3,
  request: 4,
  awaiting: 4,
  declined: 4,
  timeout: 4,
  uncertain: 4,
  accessLost: 4,
  setup: 5,
  setupFailed: 5,
  needsUpdate: 5,
  hostKeyChanged: 5,
  cancelling: 5,
  cleanupFailed: 5,
  success: 6,
};

const ILLUSTRATIONS: Partial<Record<FramePage, string>> = {
  devmode: 'settings',
  pairhost: 'settings',
  search: 'searching',
  found: 'devices',
  request: 'devices',
  notfound: 'not-found',
  awaiting: 'approval-pending',
  declined: 'request-stopped',
  timeout: 'request-stopped',
  setup: 'setup-running',
  setupFailed: 'setup-interrupted',
  success: 'paired',
};

const BACK: Partial<Record<FramePage, FramePage>> = {
  devmode: 'intro',
  pairhost: 'devmode',
  found: 'pairhost',
  notfound: 'pairhost',
  manual: 'pairhost',
};

@Component({
  selector: 'app-frame-pairing-modal',
  standalone: true,
  imports: [FormsModule, TranslocoModule],
  templateUrl: './frame-pairing-modal.component.html',
  styleUrl: './frame-pairing-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FramePairingModalComponent extends BaseModalComponent<void, void> {
  protected readonly frame = inject(FramePairingService);
  readonly stepLabels = [
    'before',
    'developer',
    'pairhost',
    'find',
    'approve',
    'install',
    'finished',
  ];
  readonly stages: FrameSetupStage[] = ['verify', 'install', 'connection'];
  readonly address = signal('');

  readonly flow = this.frame.flow;
  readonly page = computed(() => this.flow()?.page ?? 'intro');
  readonly busy = computed(() => !!this.flow()?.busy);
  readonly step = computed(() => STEP_OF_PAGE[this.page()]);
  readonly illustration = computed(() => ILLUSTRATIONS[this.page()]);
  readonly animated = computed(() =>
    ['searching', 'approval-pending', 'setup-running'].includes(this.illustration() ?? '')
  );
  readonly back = computed(() => (this.busy() ? undefined : BACK[this.page()]));
  readonly stageIndex = computed(() => this.stages.indexOf(this.flow()?.stage ?? 'verify'));
  readonly validAddress = computed(() => {
    const address = this.address().trim();
    const ipv4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) return ipv4.slice(1).every((part) => +part <= 255);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)*$/i.test(address);
  });

  readonly uninstallCommand = 'bash ~/.local/share/oyasumivr_helper/uninstall';
  readonly copied = signal(false);

  async copyUninstallCommand() {
    await navigator.clipboard.writeText(this.uninstallCommand);
    this.copied.set(true);
  }

  /** Opens links in the translated copy in the browser instead of this window. */
  openLink(event: MouseEvent) {
    const link = (event.target as HTMLElement).closest('a');
    if (!link) return;
    event.preventDefault();
    void openUrl(link.href);
  }

  connectManual() {
    if (this.validAddress()) void this.frame.connectManual(this.address());
  }
}
