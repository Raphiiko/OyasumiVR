import {
  Candidate,
  Cct,
  FadeEnded,
  FadeOutcome,
  Identity,
  Stage,
  State,
  Status,
} from 'src-ui/app/bindings';

/** Removes the helper and every recorded PC key line, run on the headset itself. */
export const STEAM_FRAME_UNINSTALL_COMMAND = 'bash ~/.local/share/oyasumivr_helper/uninstall';
/** How long a value set while the paired Frame cannot take it still goes out once it can. */
export const STEAM_FRAME_WAITING_SET_MS = 120_000;

/**
 * One pairing attempt or completed pairing, in memory with its secrets readable.
 * `hostKeyPin` is set once the headset approved this PC; `complete` once setup finished.
 */
export interface SteamFramePairing {
  id: string;
  deviceId: string;
  identity: Identity;
  address: string;
  user: string;
  privateKey: string;
  publicKey: string;
  token: string;
  hostKeyPin?: string;
  /** The headset may hold this key, because a registration was approved or had an unclear answer. */
  mayBeApproved?: boolean;
  certPin?: string;
  port?: number;
  complete: boolean;
  helperVersion?: string;
}

export interface SteamFramePairingData {
  version: 1;
  pairings: SteamFramePairing[];
}

export type SteamFrameConnectionStatus = Status;

export type SteamFrameConnectionState = State;

/**
 * How the helper ended a fade. `superseded` means a newer set or fade for the same control, from
 * any PC. `externalChange` means the value changed on the headset. `standby` and
 * `runtimeUnavailable` end the fades of both controls.
 */
export type SteamFrameFadeOutcome = FadeOutcome;

/** A fade the helper ended, started by this PC or another one. */
export type SteamFrameFadeEnded = FadeEnded;

export type SteamFrameCct = Cct;

export type SteamFrameSetupStage = Stage;

/** Why the headset could not be asked or cleaned up while unpairing. */
export type SteamFrameUnpairFailure = 'rejected' | 'unreachable' | 'hostKeyChanged' | 'failed';

export type SteamFramePage =
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
  | 'uncertain'
  | 'wrongDevice'
  | 'setup'
  | 'setupFailed'
  | 'needsUpdate'
  | 'cancelling'
  | 'cleanupFailed'
  | 'success';

/** The wizard's state. It lives in the service, so closing the wizard leaves setup running. */
export interface SteamFrameFlow {
  deviceId: string;
  identity: Identity;
  page: SteamFramePage;
  candidates: Candidate[];
  selected: number;
  manualAddress?: string;
  stage: SteamFrameSetupStage;
  /** A translation key under `steamFrame.errors`. */
  error?: string;
  busy: boolean;
}
