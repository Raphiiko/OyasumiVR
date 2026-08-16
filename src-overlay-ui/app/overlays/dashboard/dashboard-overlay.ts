import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Dialog } from '../../components/dialog/dialog';
import { IpcService } from '../../ipc/ipc.service';
import { AutomationConfig } from './automation-config/automation-config';
import { DeviceControl } from './device-control/device-control';
import { Overview } from './overview/overview';

export type DashboardMode = 'OVERVIEW' | 'AUTOMATIONS' | 'DEVICE_CONTROL';

@Component({
  selector: 'app-dashboard-overlay',
  imports: [AutomationConfig, DeviceControl, Dialog, Overview, TranslocoPipe],
  templateUrl: './dashboard-overlay.html',
  styleUrl: './dashboard-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardOverlay implements OnInit, OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly state = this.ipc.state;

  readonly inOverlay = !!window.CefSharp;
  readonly ready = signal(!window.CefSharp);
  readonly mode = signal<DashboardMode>('OVERVIEW');

  readonly dialogShown = signal(false);
  readonly startDisabled = signal(false);
  readonly canStart = computed(
    () => this.state().automations?.shutdownAutomations?.canStart ?? false
  );
  readonly inProgress = linkedSignal(
    () => this.state().automations?.shutdownAutomations?.running ?? false
  );

  private startTimeout: ReturnType<typeof setTimeout> | null = null;

  async ngOnInit(): Promise<void> {
    window.OyasumiIPCIn.showDashboard = async () => this.ready.set(true);
    window.OyasumiIPCIn.hideDashboard = async () => this.ready.set(false);
    if (window.CefSharp) await window.CefSharp.BindObjectAsync('OyasumiIPCOut_Dashboard');
    await window.OyasumiIPCOut.onUiReady();
  }

  ngOnDestroy(): void {
    if (this.startTimeout) clearTimeout(this.startTimeout);
  }

  async closeDashboard(): Promise<void> {
    await window.OyasumiIPCOut_Dashboard.close();
  }

  openShutdownSequence(): void {
    this.dialogShown.set(true);
    this.startDisabled.set(true);
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.startTimeout = setTimeout(() => {
      this.startDisabled.set(false);
      this.startTimeout = null;
    }, 2000);
  }

  closeShutdownSequence(): void {
    if (this.startTimeout) clearTimeout(this.startTimeout);
    this.dialogShown.set(false);
    this.inProgress.set(false);
  }

  startShutdownSequence(): void {
    void this.ipc.startShutdownSequence();
    this.closeShutdownSequence();
  }
}
