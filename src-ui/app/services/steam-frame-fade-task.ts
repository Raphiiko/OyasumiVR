import { invoke } from '@tauri-apps/api/core';
import {
  filter,
  firstValueFrom,
  map,
  NEVER,
  Observable,
  of,
  race,
  ReplaySubject,
  switchMap,
  timer,
} from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { CancellableTask } from '../utils/cancellable-task';
import {
  SteamFrameConnectionState,
  SteamFrameControl,
  SteamFrameFadeEnded,
  SteamFrameFadeError,
  SteamFrameFadeOutcome,
} from '../models/steam-frame';

/** How a fade ended. `missed` means the helper dropped it while this PC was disconnected. */
export type SteamFrameFadeEnd = SteamFrameFadeOutcome | 'missed';

export interface SteamFrameFadeSource {
  connections$: Observable<Record<string, SteamFrameConnectionState>>;
  fadeEnded$: Observable<SteamFrameFadeEnded>;
}

/** A fade for the helper. `target` is in percent or Kelvin. */
export interface SteamFrameFadeRequest {
  pairingId: string;
  control: SteamFrameControl;
  target: number;
  durationMs: number;
  /** A simple-mode curve, which the helper maps to hardware brightness at every step. */
  simple?: { from: number; to: number };
}

/**
 * A fade the helper runs. It completes on outcome `completed`, and at its end time while the
 * helper connection is down. Every other outcome cancels it. Cancelling it from outside cancels
 * the fade on the helper.
 */
export class SteamFrameFadeTask extends CancellableTask {
  readonly operation = uuidv4();
  readonly pairingId: string;
  /** How the fade ended, set before the task cancels itself; null after a cancel from outside. */
  end: SteamFrameFadeEnd | null = null;

  constructor(
    private readonly request: SteamFrameFadeRequest,
    private readonly frames: SteamFrameFadeSource,
    /** Runs once the helper accepts the fade. */
    private readonly onAccept?: () => void
  ) {
    super();
    this.pairingId = request.pairingId;
    this.work = () => this.run();
  }

  private async run(): Promise<void> {
    // listen before sending, so a short fade's outcome is not lost
    const outcome = new ReplaySubject<SteamFrameFadeEnd>(1);
    const subscription = this.frames.fadeEnded$
      .pipe(
        filter((e) => e.pairingId === this.request.pairingId && e.operation === this.operation),
        map((e) => e.outcome)
      )
      .subscribe(outcome);
    try {
      const error = await this.send();
      if (this.isCancelled()) {
        if (!error) this.cancelOnHelper();
        return;
      }
      if (error) throw error;
      this.onAccept?.();

      // wait for the outcome, the end time while disconnected, or a cancel from outside
      const endsAt = Date.now() + this.request.durationMs;
      const end = await firstValueFrom(
        race(outcome, this.untilEndWhileDown(endsAt), this.cancelled())
      );
      if (end === null) {
        this.cancelOnHelper();
        return;
      }
      this.end = end;
      if (end !== 'completed') this.cancel();
    } finally {
      subscription.unsubscribe();
    }
  }

  private send(): Promise<SteamFrameFadeError | null> {
    const { pairingId, ...fade } = this.request;
    return invoke('steam_frame_fade', {
      pairingId,
      request: { ...fade, operation: this.operation },
    }).then(
      () => null,
      (error: SteamFrameFadeError) => error
    );
  }

  private cancelOnHelper() {
    void invoke('steam_frame_cancel_fade', {
      pairingId: this.request.pairingId,
      operation: this.operation,
    }).catch(() => {});
  }

  private cancelled(): Observable<null> {
    return this.onCancelled.pipe(map(() => null));
  }

  private connection(): Observable<SteamFrameConnectionState | undefined> {
    return this.frames.connections$.pipe(map((states) => states[this.request.pairingId]));
  }

  /**
   * Completes at the end time while the connection is down or reports nothing. After that, a report
   * without this fade means the helper ended it meanwhile.
   */
  private untilEndWhileDown(endsAt: number): Observable<SteamFrameFadeEnd> {
    let wasDown = false;
    return this.connection().pipe(
      switchMap((state): Observable<SteamFrameFadeEnd> => {
        // a helper update keeps the status connected and only clears the reports
        const report =
          state?.status !== 'connected'
            ? null
            : this.request.control === 'brightness'
              ? state.brightness
              : state.cct;
        if (!report) {
          wasDown = true;
          return timer(Math.max(0, endsAt - Date.now())).pipe(map(() => 'completed' as const));
        }
        if (!wasDown) return NEVER;
        wasDown = false;
        return report.fade?.operation === this.operation ? NEVER : of('missed' as const);
      })
    );
  }
}

/** A brightness fade. `targetBrightness` is the value the UI shows as the target. */
export class SteamFrameBrightnessFade extends SteamFrameFadeTask {
  constructor(
    readonly targetBrightness: number,
    ...args: ConstructorParameters<typeof SteamFrameFadeTask>
  ) {
    super(...args);
  }
}
