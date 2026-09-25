export interface FrameIdentity {
  serial: string;
  model: string;
  manufacturer: string;
}

export interface FrameCandidate {
  name: string;
  address: string;
}

/**
 * One pairing attempt or completed pairing, in memory with its secrets readable.
 * `hostKeyPin` is set once the headset approved this PC; `complete` once setup finished.
 */
export interface FramePairing {
  id: string;
  deviceId: string;
  identity: FrameIdentity;
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

export interface FramePairingData {
  version: 1;
  pairings: FramePairing[];
}

export type FrameConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'offline'
  | 'identityChanged'
  | 'needsAppUpdate'
  | 'helperOutdated'
  | 'hostKeyChanged';

export interface FrameConnectionState {
  pairingId: string;
  status: FrameConnectionStatus;
  lastSeen?: number;
  helperVersion?: string;
  address: string;
  certPin: string;
}

export type FrameRegisterOutcome =
  'registered' | 'declined' | 'timeout' | 'notReady' | 'unreachable' | 'lost' | 'failed';

export type FrameProbeOutcome =
  | { status: 'ok'; hostKeyPin: string }
  | { status: 'rejected' | 'unreachable' | 'hostKeyChanged' }
  | { status: 'failed'; message: string };

export type FrameSetupStage = 'verify' | 'install' | 'connection';

export type FrameSetupResult = { installed: boolean } & (
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

export type FrameCleanupOutcome =
  | { status: 'done' | 'unreachable' | 'hostKeyChanged' | 'helperBusy' }
  | { status: 'failed'; message: string };

export type FramePage =
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
export interface FrameFlow {
  deviceId: string;
  identity: FrameIdentity;
  page: FramePage;
  candidates: FrameCandidate[];
  selected: number;
  manualAddress?: string;
  stage: FrameSetupStage;
  /** A translation key under `frame.errors`. */
  error?: string;
  busy: boolean;
}
