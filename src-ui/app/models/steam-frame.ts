/** Removes the helper and every recorded PC key line, run on the headset itself. */
export const STEAM_FRAME_UNINSTALL_COMMAND = 'bash ~/.local/share/oyasumivr_helper/uninstall';
/** How long a value set while the paired Frame cannot take it still goes out once it can. */
export const STEAM_FRAME_WAITING_SET_MS = 120_000;

export interface SteamFrameIdentity {
  serial: string;
  model: string;
  manufacturer: string;
}

export interface SteamFrameCandidate {
  name: string;
  address: string;
}

/**
 * One pairing attempt or completed pairing, in memory with its secrets readable.
 * `hostKeyPin` is set once the headset approved this PC; `complete` once setup finished.
 */
export interface SteamFramePairing {
  id: string;
  deviceId: string;
  identity: SteamFrameIdentity;
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
  helperInstalledByPairing?: boolean;
  complete: boolean;
  lastSeen?: number;
  helperVersion?: string;
}

export interface SteamFramePairingData {
  version: 1;
  pairings: SteamFramePairing[];
}

export type SteamFrameConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'identityChanged'
  | 'needsAppUpdate'
  | 'helperOutdated'
  | 'hostKeyChanged'
  | 'helperMissing'
  | 'pairingRemoved';

export type SteamFrameUpdateFailReason =
  'unreachable' | 'corrupted' | 'notStarted' | 'notBundled' | 'other';

export type SteamFrameMaintenance =
  | { kind: 'updating' | 'busy' }
  | { kind: 'updated'; version: string }
  | { kind: 'failed'; reason: SteamFrameUpdateFailReason };

export interface SteamFrameConnectionState {
  pairingId: string;
  status: SteamFrameConnectionStatus;
  lastSeen?: number;
  helperVersion?: string;
  /** The helper is older than the bundled one, or has other files at the same version. */
  updateAvailable: boolean;
  maintenance: SteamFrameMaintenance | null;
  address: string;
  certPin: string;
  /** The helper's last brightness report; null while not connected. */
  brightness: SteamFrameBrightness | null;
  /** The helper's last color temperature report; null while not connected. */
  cct: SteamFrameCct | null;
}

/** The headset's hardware brightness in percent, as the helper reports it. */
export interface SteamFrameBrightness {
  /** False while the helper has no SteamVR session; nothing else is known then. */
  runtime: boolean;
  supported: boolean;
  min: number | null;
  max: number | null;
  /** The headset's value, which can lie outside `min` and `max`. */
  percentage: number | null;
}

/** The headset's color temperature, as the helper reports it. */
export interface SteamFrameCct {
  /** False while the helper has no SteamVR session; nothing else is known then. */
  available: boolean;
  gains: [number, number, number] | null;
  /** The nearest integer Kelvin on OyasumiVR's curve. */
  kelvin: number | null;
  /** True when the gains lie on the curve at `kelvin`. */
  exact: boolean | null;
}

export type SteamFrameRegisterOutcome =
  'registered' | 'declined' | 'timeout' | 'notReady' | 'unreachable' | 'lost' | 'failed';

export type SteamFrameProbeOutcome =
  | { status: 'ok'; hostKeyPin: string }
  | { status: 'rejected' | 'unreachable' | 'hostKeyChanged' }
  | { status: 'failed'; message: string };

export type SteamFrameSetupStage = 'verify' | 'install' | 'connection';

export type SteamFrameSetupResult = { installed: boolean } & (
  | {
      status: 'complete';
      certPin: string;
      port: number;
      helperVersion: string;
    }
  | { status: 'needsAppUpdate'; helperVersion: string }
  | { status: 'failed'; message: string }
  | {
      status:
        | 'wrongDevice'
        | 'identityMissing'
        | 'helperBusy'
        | 'hostKeyChanged'
        | 'rejected'
        | 'unreachable';
    }
);

export type SteamFrameCleanupMode = 'keep' | 'unused' | 'uninstall';

export type SteamFrameOtherPcsOutcome =
  | { status: 'ok'; count: number }
  | { status: 'rejected' | 'unreachable' | 'hostKeyChanged' }
  | { status: 'failed'; message: string };

export type SteamFrameCleanupOutcome =
  | { status: 'done' | 'rejected' | 'unreachable' | 'hostKeyChanged' | 'helperBusy' }
  | { status: 'failed'; message: string };

/** Why the headset could not be asked or cleaned up while unpairing. */
export type SteamFrameUnpairFailure =
  'rejected' | 'unreachable' | 'hostKeyChanged' | 'helperBusy' | 'failed';

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
  | 'accessLost'
  | 'wrongDevice'
  | 'setup'
  | 'setupFailed'
  | 'needsUpdate'
  | 'hostKeyChanged'
  | 'cancelling'
  | 'cleanupFailed'
  | 'success';

/** The wizard's state. It lives in the service, so closing the wizard leaves setup running. */
export interface SteamFrameFlow {
  deviceId: string;
  identity: SteamFrameIdentity;
  page: SteamFramePage;
  candidates: SteamFrameCandidate[];
  selected: number;
  manualAddress?: string;
  stage: SteamFrameSetupStage;
  /** A translation key under `steamFrame.errors`. */
  error?: string;
  busy: boolean;
}
