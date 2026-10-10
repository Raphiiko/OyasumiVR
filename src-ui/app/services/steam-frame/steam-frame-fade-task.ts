import { invoke } from '@tauri-apps/api/core';
import { filter, firstValueFrom, map, Observable, race, ReplaySubject, timer } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { DeviceFade, DeviceFadeEnd } from '../../utils/device-fade';
import {
  SteamFrameControl,
  SteamFrameFadeEnded,
  SteamFrameFadeError,
  SteamFrameFadeOutcome,
} from '../../models/steam-frame';

/** The longest fade the helper accepts; it sends no reply to a longer one. */
export const STEAM_FRAME_MAX_FADE_MS = 24 * 60 * 60 * 1000;

export type SteamFrameFadeEnd = SteamFrameFadeOutcome;

/** What a fade task watches while it runs. */
export interface SteamFrameFadeSource {
  fadeEnded$: Observable<SteamFrameFadeEnded>;
}

/** A fade for the helper. `target` is in percent or Kelvin. A longer fade than 24 hours is cut. */
export interface SteamFrameFadeRequest {
  pairingId: string;
  control: SteamFrameControl;
  target: number;
  durationMs: number;
  /** A simple-mode curve, which the helper maps to hardware brightness at every step. */
  simple?: { from: number; to: number };
}

/**
 * A fade the helper runs. It completes on outcome `completed`, or at its end time when no outcome
 * reached this PC, such as after a disconnect. Every other outcome cancels it. Cancelling it from
 * outside cancels the fade on the helper.
 */
export class SteamFrameFadeTask extends DeviceFade {
  readonly operation = uuidv4();
  private readonly request: SteamFrameFadeRequest;

  constructor(
    request: SteamFrameFadeRequest,
    private readonly frames: SteamFrameFadeSource,
    /** Runs once the helper accepts the fade. */
    private readonly onAccept?: () => void
  ) {
    super();
    this.request = {
      ...request,
      durationMs: Math.min(request.durationMs, STEAM_FRAME_MAX_FADE_MS),
    };
    this.work = () => this.run();
  }

  get durationMs(): number {
    return this.request.durationMs;
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

      // wait for the outcome, the end time, or a cancel from outside
      const endOfFade = timer(this.request.durationMs).pipe(map(() => 'completed' as const));
      const end = await firstValueFrom(race(outcome, endOfFade, this.cancelled()));
      if (end === null) {
        this.cancelOnHelper();
        return;
      }
      // a cancel from outside can land while the outcome resolves, and then wins
      if (this.isCancelled()) return;
      this.finish(end);
    } finally {
      subscription.unsubscribe();
    }
  }

  private finish(outcome: SteamFrameFadeEnd) {
    this.end = deviceFadeEnd(outcome);
    if (outcome !== 'completed') this.cancel();
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

/** A color temperature fade. `targetCCT` is the value the UI shows as the target. */
export class SteamFrameCctFade extends SteamFrameFadeTask {
  constructor(
    readonly targetCCT: number,
    ...args: ConstructorParameters<typeof SteamFrameFadeTask>
  ) {
    super(...args);
  }
}

function deviceFadeEnd(outcome: SteamFrameFadeEnd): DeviceFadeEnd {
  if (outcome === 'completed') return 'completed';
  return outcome === 'externalChange' ? 'changedOnDevice' : 'stopped';
}
