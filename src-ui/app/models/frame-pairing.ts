export type FrameAction = 'pair' | 'retry' | 'repair' | 'unpair' | 'forget_local' | 'cleanup';
export type FrameStep =
  | 'selected'
  | 'verifying_ssh'
  | 'awaiting_approval'
  | 'verifying_identity'
  | 'installing'
  | 'verifying_companion'
  | 'connected'
  | 'offline'
  | 'repair_needed'
  | 'removing'
  | 'forgotten'
  | 'finishing_cleanup'
  | 'cancelled'
  | 'failed';
export const FRAME_ERRORS = [
  'invalid_input',
  'setup_incomplete',
  'maintenance_backoff',
  'artifact_unavailable',
  'discovery_unavailable',
  'persistence',
  'unsupported_platform',
  'offline',
  'host_key_changed',
  'authentication_failed',
  'companion_authentication_failed',
  'not_armed',
  'denied',
  'timeout',
  'busy',
  'registration_uncertain',
  'cancelled',
  'identity_unverified',
  'remote_operation',
  'certificate_changed',
  'wrong_device',
  'protocol_mismatch',
] as const;
export type FrameError = (typeof FRAME_ERRORS)[number];

export interface FrameCandidate {
  id: string;
  address: string;
  devkit_port: number;
  ssh_port: number;
  companion_port: number;
  hostname_hint: string;
}

export interface FrameState {
  revision: number;
  action: FrameAction | null;
  cancelling: boolean;
  device_manager_id: string;
  pairing_id: string;
  operation_id: string;
  in_progress: boolean;
  step: FrameStep;
  paired: boolean;
  connected: boolean;
  companion_installed: boolean | null;
  steamvr_ready: boolean;
  error: FrameError | null;
  maintenance_error: FrameError | null;
  remote_removal_performed: boolean;
  address: string;
  installed_version: string | null;
  paired_at: number | null;
  last_contact: number | null;
  access_verified: boolean;
  setup_stage: number;
  repair_needed: boolean;
  cleanup_pending: boolean;
}

export function frameError(error: unknown): FrameError {
  return FRAME_ERRORS.includes(error as FrameError) ? (error as FrameError) : 'remote_operation';
}

export function frameStateError(state?: FrameState): FrameError | null {
  if (!state) return null;
  if (state.in_progress) return state.error;
  return state.error && state.error !== 'offline'
    ? state.error
    : (state.maintenance_error ?? state.error);
}

export function removedPairing(state: FrameState): boolean {
  return (
    !state.in_progress &&
    !state.paired &&
    !state.error &&
    (state.step === 'forgotten' || (state.step === 'removing' && state.remote_removal_performed))
  );
}

export function frameStatus(state?: FrameState): string {
  if (!state || removedPairing(state)) return 'notPaired';
  if (state.cleanup_pending && !state.in_progress) return 'cleaningUp';
  if (state.in_progress) {
    if (state.action === 'unpair' || state.action === 'forget_local') return 'removing';
    if (state.cancelling || state.action === 'cleanup') return 'cleaningUp';
    if (state.action === 'repair') return 'repairing';
    if (!state.paired) return 'settingUp';
    return state.step === 'installing' ? 'updating' : 'connecting';
  }
  if (state.repair_needed) return 'repairNeeded';
  const error = frameStateError(state);
  if (
    ['host_key_changed', 'certificate_changed', 'wrong_device', 'identity_unverified'].includes(
      error ?? ''
    )
  )
    return 'identityChanged';
  if (error === 'protocol_mismatch') return 'incompatible';
  if (error === 'authentication_failed') return 'accessLost';
  if (error === 'companion_authentication_failed') return 'helperAccessLost';
  if (state.maintenance_error) return 'updateFailed';
  if (!state.paired) return 'incomplete';
  return state.connected ? 'connected' : 'offline';
}

export const FRAME_MANUAL_UNINSTALL_COMMAND = 'bash "$HOME/.local/share/oyasumivr/frame/uninstall"';
