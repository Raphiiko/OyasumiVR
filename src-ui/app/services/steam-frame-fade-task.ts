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

/** A refusal can arrive before the connection state that shows the hold, so wait this long for it. */
const HOLD_NOTICE_MS = 2000;

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
 * the fade on the helper. A helper without fades gets the target in one command instead.
 */
export class SteamFrameFadeTask extends CancellableTask {
  readonly operation = uuidv4();
  /** How the fade ended, set before the task cancels itself; null after a cancel from outside. */
  end: SteamFrameFadeEnd | null = null;

  constructor(
    private readonly request: SteamFrameFadeRequest,
    private readonly frames: SteamFrameFadeSource,
    /** Writes the target in one command, for a refused fade whose time ran out meanwhile. */
    private readonly set: (target: number) => Promise<void>,
    /** Runs with the accepted duration once the helper accepts the fade. */
    private readonly onAccept?: (durationMs: number) => void
  ) {
    super();
    this.work = () => this.run();
  }

  private async run(): Promise<void> {
    if (!(await firstValueFrom(this.connection()))?.fades) {
      await this.set(this.request.target);
      return;
    }

    // listen before sending, so a short fade's outcome is not lost
    const outcome = new ReplaySubject<SteamFrameFadeEnd>(1);
    const subscription = this.frames.fadeEnded$
      .pipe(
        filter((e) => e.pairingId === this.request.pairingId && e.operation === this.operation),
        map((e) => e.outcome)
      )
      .subscribe(outcome);
    try {
      // send, and after a maintenance hold send again with the time that remains
      const firstSent = Date.now();
      let durationMs = this.request.durationMs;
      for (;;) {
        const error = await this.send(durationMs);
        if (this.isCancelled()) {
          if (!error) this.cancelOnHelper();
          return;
        }
        if (!error) break;
        if (error !== 'maintenance') throw error;
        await this.whenHoldEnds();
        if (this.isCancelled()) return;
        durationMs = this.request.durationMs - (Date.now() - firstSent);
        if (durationMs <= 0) {
          await this.set(this.request.target);
          return;
        }
      }
      this.onAccept?.(durationMs);

      // wait for the outcome, the end time while disconnected, or a cancel from outside
      const end = await firstValueFrom(
        race(outcome, this.untilEndWhileDown(Date.now() + durationMs), this.cancelled())
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

  private send(durationMs: number): Promise<SteamFrameFadeError | null> {
    const { pairingId, ...fade } = this.request;
    return invoke('steam_frame_fade', {
      pairingId,
      request: { ...fade, operation: this.operation, durationMs },
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
   * Completes at the end time while the connection is down. After a reconnect, a report without
   * this fade means the helper ended it meanwhile.
   */
  private untilEndWhileDown(endsAt: number): Observable<SteamFrameFadeEnd> {
    let wasDown = false;
    return this.connection().pipe(
      switchMap((state): Observable<SteamFrameFadeEnd> => {
        if (state?.status !== 'connected') {
          wasDown = true;
          return timer(Math.max(0, endsAt - Date.now())).pipe(map(() => 'completed' as const));
        }
        const report = this.request.control === 'brightness' ? state.brightness : state.cct;
        if (!wasDown || !report) return NEVER;
        wasDown = false;
        return report.fade?.operation === this.operation ? NEVER : of('missed' as const);
      })
    );
  }

  /** Waits until the helper takes fades again: its hold ended or its handshake returned. */
  private async whenHoldEnds() {
    const usable = (state?: SteamFrameConnectionState) =>
      state?.status === 'connected' && !state.hold;
    await firstValueFrom(
      race(
        this.connection().pipe(filter((state) => !usable(state))),
        timer(HOLD_NOTICE_MS),
        this.cancelled()
      )
    );
    await firstValueFrom(race(this.connection().pipe(filter(usable)), this.cancelled()));
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

export class SteamFrameCctFade extends SteamFrameFadeTask {
  constructor(
    readonly targetCCT: number,
    ...args: ConstructorParameters<typeof SteamFrameFadeTask>
  ) {
    super(...args);
  }
}
