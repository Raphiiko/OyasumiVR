import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  output,
  signal,
  WritableSignal,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { Tooltip } from '../../../directives/tooltip';
import { IpcService } from '../../../ipc/ipc.service';

const PRESS_COOLDOWN = 400;

@Component({
  selector: 'app-dashboard-device-control',
  imports: [Tooltip, TranslocoPipe],
  templateUrl: './device-control.html',
  styleUrl: './device-control.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceControl implements OnDestroy {
  private readonly ipc = inject(IpcService);
  private readonly transloco = inject(TranslocoService);

  readonly navigate = output<'OVERVIEW'>();
  readonly closeDashboard = output<void>();

  private readonly state = this.ipc.state;
  private readonly activeControllers = computed(() =>
    (this.state().deviceInfo?.controllers ?? []).filter(
      (d) => d.serialNumber && d.canPowerOff && !d.isTurningOff
    )
  );
  private readonly activeTrackers = computed(() =>
    (this.state().deviceInfo?.trackers ?? []).filter(
      (d) => d.serialNumber && d.canPowerOff && !d.isTurningOff
    )
  );

  private readonly controllersReady = signal(true);
  private readonly trackersReady = signal(true);
  private readonly bothReady = signal(true);

  readonly canTurnOffControllers = computed(
    () => this.activeControllers().length > 0 && this.controllersReady()
  );
  readonly canTurnOffTrackers = computed(
    () => this.activeTrackers().length > 0 && this.trackersReady()
  );
  readonly canTurnOffBoth = computed(
    () => this.canTurnOffControllers() && this.canTurnOffTrackers() && this.bothReady()
  );

  private readonly timeouts: ReturnType<typeof setTimeout>[] = [];

  ngOnDestroy(): void {
    this.timeouts.forEach(clearTimeout);
  }

  turnOffControllers(): void {
    if (!this.canTurnOffControllers()) return;
    this.startCooldown(this.controllersReady);
    this.notify('notifications.turningOffControllers.content');
    this.turnOff(this.controllerSerialNumbers());
    this.delay(500, () => this.closeDashboard.emit());
  }

  turnOffTrackers(): void {
    if (!this.canTurnOffTrackers()) return;
    this.startCooldown(this.trackersReady);
    this.notify('notifications.turningOffTrackers.content');
    this.turnOff(this.trackerSerialNumbers());
  }

  turnOffControllersAndTrackers(): void {
    if (!this.canTurnOffBoth()) return;
    this.startCooldown(this.bothReady);
    this.notify('notifications.turningOffControllersAndTrackers.content');
    this.turnOff([...this.trackerSerialNumbers(), ...this.controllerSerialNumbers()]);
    this.delay(500, () => this.closeDashboard.emit());
  }

  private controllerSerialNumbers(): string[] {
    return (this.state().deviceInfo?.controllers ?? [])
      .map((device) => device.serialNumber)
      .filter((serialNumber): serialNumber is string => !!serialNumber);
  }

  private trackerSerialNumbers(): string[] {
    return (this.state().deviceInfo?.trackers ?? [])
      .map((device) => device.serialNumber)
      .filter((serialNumber): serialNumber is string => !!serialNumber);
  }

  private turnOff(deviceSerialNumbers: string[]): void {
    void this.ipc.turnOffOVRDevices(deviceSerialNumbers);
  }

  private notify(key: string): void {
    void this.ipc.addNotification(this.transloco.translate<string>(key), 3000);
  }

  private startCooldown(ready: WritableSignal<boolean>): void {
    ready.set(false);
    this.delay(PRESS_COOLDOWN, () => ready.set(true));
  }

  private delay(ms: number, action: () => void): void {
    this.timeouts.push(setTimeout(action, ms));
  }
}
