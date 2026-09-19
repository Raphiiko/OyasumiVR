import { invoke } from '@tauri-apps/api/core';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  merge,
  Observable,
  Subscription,
} from 'rxjs';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { AppSettings } from '../../../models/settings';
import { FrameBrightnessState, FrameState } from '../../../models/frame-pairing';
import { OpenVRService } from '../../openvr.service';
import { CancellableTask } from '../../../utils/cancellable-task';

type BrightnessCommand = {
  type: string;
  operation_id: string;
  percentage?: number;
  duration_ms?: number;
  simple?: { from: number; to: number } | null;
};
interface PendingCommand {
  pairing: string;
  command: BrightnessCommand;
  resolve: (state: FrameBrightnessState) => void;
  reject: (error: unknown) => void;
}

export class SteamFrameHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  readonly snapshot = new BehaviorSubject<FrameState | undefined>(undefined);
  readonly requested = new BehaviorSubject<{ id: string; percentage: number } | null>(null);
  readonly error = new BehaviorSubject<string | null>(null);
  readonly appliedBrightness = this.snapshot.pipe(
    map((state) => state?.brightness?.applied),
    filter((value): value is number => value != null),
    distinctUntilChanged()
  );
  private subscription: Subscription;
  private generation = 0;
  private submitting = false;
  private pending?: PendingCommand;

  constructor(
    settings: Observable<AppSettings>,
    states: Observable<FrameState[]>,
    openvr: OpenVRService
  ) {
    super(settings);
    this.subscription = combineLatest([states, openvr.devices, openvr.status]).subscribe(
      ([pairings, devices, status]) => {
        const hmd = devices.find((device) => device.class === 'HMD');
        const state =
          status === 'INITIALIZED' && hmd
            ? pairings.find(
                (pairing) =>
                  pairing.device_manager_id === `OVR_HMD_${hmd.serialNumber}` && pairing.paired
              )
            : undefined;
        if (this.pending && (!state?.connected || state.pairing_id !== this.pending.pairing)) {
          this.pending.reject('offline');
          this.pending = undefined;
        }
        this.snapshot.next(state);
      }
    );
  }

  override dispose() {
    super.dispose();
    this.pending?.reject('offline');
    this.pending = undefined;
    this.subscription.unsubscribe();
    this.snapshot.complete();
    this.error.complete();
    this.requested.complete();
  }

  isAvailable(): Observable<boolean> {
    return this.snapshot.pipe(
      map((state) => !!state?.connected && !state.in_progress && !!state.brightness?.ready),
      distinctUntilChanged()
    );
  }

  getBrightnessBounds(): [number, number] {
    const bounds = this.snapshot.value?.brightness?.bounds;
    if (!bounds) return [0, 100];
    const percent = (gain: number) => (gain >= 1 ? gain * 100 : Math.pow(gain, 1 / 2.2) * 100);
    return [percent(bounds.min), percent(bounds.max)];
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    const bounds = this.getBrightnessBounds();
    return {
      softwareStops: bounds,
      hardwareStops: bounds,
      overdriveThreshold: 100,
      riskThreshold: bounds[1],
    };
  }

  async getBrightnessPercentage(): Promise<number> {
    const state = this.snapshot.value;
    if (!state?.connected || state.brightness?.applied == null) throw 'not_ready';
    return state.brightness.applied;
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    const id = crypto.randomUUID();
    await this.execute(id, { type: 'set_brightness', operation_id: id, percentage });
  }

  transitionBrightness = (
    percentage: number,
    duration: number,
    simple?: { from: number; to: number },
    progress?: (fraction: number) => Promise<void>
  ): CancellableTask => {
    const id = crypto.randomUUID();
    const pairing = this.snapshot.value?.pairing_id;
    let task: CancellableTask;
    task = new CancellableTask(async () => {
      const cancel = task.onCancelled.subscribe(() => {
        if (pairing)
          void this.dispatch(pairing, { type: 'cancel_brightness', operation_id: id }).catch(
            (error) => {
              if (error !== 'stale_operation') this.error.next('offline');
            }
          );
      });
      try {
        if (task.isCancelled()) return;
        await this.execute(
          id,
          {
            type: 'transition_brightness',
            operation_id: id,
            percentage,
            duration_ms: Math.round(duration),
            simple: simple ?? null,
          },
          progress,
          task.onCancelled
        );
      } finally {
        cancel.unsubscribe();
      }
    });
    return task;
  };

  private dispatch(pairing: string, command: BrightnessCommand): Promise<FrameBrightnessState> {
    if (command.percentage !== undefined)
      this.requested.next({ id: command.operation_id, percentage: command.percentage });
    return new Promise((resolve, reject) => {
      const next = { pairing, command, resolve, reject };
      if (!this.submitting) {
        this.send(next);
        return;
      }
      if (
        command.type === 'cancel_brightness' &&
        this.pending &&
        this.pending.command.operation_id !== command.operation_id
      ) {
        reject('stale_operation');
        return;
      }
      this.pending?.reject('stale_operation');
      this.pending = next;
    });
  }

  private send(request: PendingCommand) {
    this.submitting = true;
    void invoke<FrameBrightnessState>('frame_brightness', {
      pairingId: request.pairing,
      command: request.command,
    })
      .then(
        (state) => {
          if (this.requested.value?.id === request.command.operation_id) this.requested.next(null);
          request.resolve(state);
        },
        (error) => {
          if (this.requested.value?.id === request.command.operation_id) this.requested.next(null);
          request.reject(error);
          if (error === 'offline') {
            this.pending?.reject(error);
            this.pending = undefined;
          }
        }
      )
      .finally(() => {
        const next = this.pending;
        this.pending = undefined;
        this.submitting = false;
        if (next) this.send(next);
      });
  }

  private async execute(
    id: string,
    command: BrightnessCommand,
    progress?: (fraction: number) => Promise<void>,
    cancelled?: Observable<void>
  ): Promise<void> {
    const generation = ++this.generation;
    const pairing = this.snapshot.value?.pairing_id;
    if (!pairing) throw 'not_ready';
    let session = this.snapshot.value?.brightness_session;
    this.error.next(null);
    try {
      let state = await this.dispatch(pairing, command);
      while (true) {
        if (state.phase === 'failed') throw state.error ?? 'write_failed';
        if (state.phase === 'cancelled') return;
        if (progress) await progress(state.progress);
        if (state.phase === 'completed') return;
        const revision = state.revision;
        const next: Observable<FrameState | undefined> = this.snapshot.pipe(
          filter(
            (snapshot) =>
              !snapshot ||
              snapshot.pairing_id !== pairing ||
              (snapshot.connected &&
                !!snapshot.brightness &&
                (snapshot.brightness.revision > revision ||
                  snapshot.brightness_session !== session))
          )
        );
        const snapshot: FrameState | undefined | null = await firstValueFrom(
          cancelled ? merge(next, cancelled.pipe(map(() => null))) : next
        );
        if (snapshot === null) return;
        if (!snapshot || snapshot.pairing_id !== pairing || !snapshot.brightness) throw 'offline';
        session = snapshot.brightness_session;
        state = snapshot.brightness;
        if (state.operation_id !== id) throw 'stale_operation';
      }
    } catch (error) {
      if (this.requested.value?.id === id) this.requested.next(null);
      if (generation === this.generation && error !== 'stale_operation')
        this.error.next(typeof error === 'string' ? error : 'write_failed');
      throw error;
    }
  }
}
