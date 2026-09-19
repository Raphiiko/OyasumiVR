import '@angular/compiler';
import { beforeEach, expect, it, vi } from 'vitest';
import { FramePairingService } from './frame-pairing.service';
import { FrameState, frameStatus, removedPairing } from '../models/frame-pairing';
import {
  FramePairingComponent,
  pairingPage,
} from '../components/frame-pairing/frame-pairing.component';
import { signal } from '@angular/core';
import { ModalService } from './modal.service';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }));

const state: FrameState = {
  revision: 1,
  device_manager_id: 'OVR_HMD_SYNTHETIC-001',
  pairing_id: 'synthetic-pairing',
  operation_id: 'synthetic-operation',
  action: 'pair',
  cancelling: false,
  in_progress: true,
  step: 'awaiting_approval',
  paired: false,
  connected: false,
  companion_installed: null,
  steamvr_ready: false,
  error: null,
  maintenance_error: null,
  remote_removal_performed: false,
  address: '127.0.0.1',
  installed_version: null,
  paired_at: null,
  last_contact: null,
  access_verified: false,
  setup_stage: 0,
  repair_needed: false,
  cleanup_pending: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockResolvedValue(mocks.unlisten);
  mocks.invoke.mockResolvedValue([]);
});

it('keeps closing available after repeated cleanup failures', async () => {
  const current = signal({ ...state, in_progress: false, cleanup_pending: true });
  const guide = Object.assign(Object.create(FramePairingComponent.prototype), {
    state: current,
    pending: signal(false),
    cancelling: signal(false),
    error: signal(null),
    page: signal('cleanupFailed'),
    busy: () => false,
    pairing: { run: vi.fn().mockResolvedValue('synthetic-operation') },
    close: vi.fn(),
  }) as FramePairingComponent;
  await guide.run('cleanup');
  current.update((value) => ({ ...value, revision: 2, error: 'offline' }));
  await guide.run('cleanup');
  current.update((value) => ({ ...value, revision: 3, error: 'offline' }));
  await guide.cancelPairing();
  expect(guide.close).toHaveBeenCalledOnce();
  expect(guide.pairing.run).toHaveBeenCalledTimes(2);
});

it('subscribes before the snapshot and ignores older events and snapshots', async () => {
  let deliver!: (event: { payload: FrameState }) => void;
  mocks.listen.mockImplementation(async (_event, listener) => {
    deliver = listener;
    return mocks.unlisten;
  });
  mocks.invoke.mockImplementation(async () => {
    deliver({
      payload: { ...state, revision: 4, operation_id: 'new-operation', step: 'installing' },
    });
    return [{ ...state, revision: 2 }];
  });
  const service = new FramePairingService({} as ModalService);
  await service.init();
  deliver({ payload: { ...state, revision: 3, step: 'failed' } });
  expect(service.forDevice(state.device_manager_id)?.step).toBe('installing');
  expect(service.forDevice(state.device_manager_id)?.operation_id).toBe('new-operation');
  service.ngOnDestroy();
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  deliver({ payload: { ...state, revision: 5 } });
  expect(service.states()[0].revision).toBe(4);
});

it('prevents simultaneous dispatch before a backend operation ID arrives', async () => {
  let finish!: () => void;
  const blocked = new Promise<void>((resolve) => (finish = resolve));
  mocks.invoke.mockImplementation(async (command) => (command === 'frame_run' ? blocked : []));
  const service = new FramePairingService({} as ModalService);
  await service.init();
  const first = service.run({ ...state, in_progress: false }, 'retry');
  await expect(service.run({ ...state, in_progress: false }, 'retry')).rejects.toBe('busy');
  finish();
  await first;
  expect(mocks.invoke.mock.calls.filter(([command]) => command === 'frame_run')).toHaveLength(1);
  service.ngOnDestroy();
});

it('releases a listener that finishes registering after service destruction', async () => {
  let finish!: (unlisten: () => void) => void;
  mocks.listen.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
  const service = new FramePairingService({} as ModalService);
  const ready = service.init();
  service.ngOnDestroy();
  finish(mocks.unlisten);
  await ready;
  expect(mocks.unlisten).toHaveBeenCalledOnce();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it('waits for authenticated completion and keeps SteamVR separate', () => {
  expect(pairingPage({ ...state, step: 'verifying_identity', access_verified: true }, false)).toBe(
    'setup'
  );
  expect(pairingPage({ ...state, step: 'connected', paired: true, connected: true }, false)).toBe(
    'setup'
  );
  expect(
    pairingPage(
      { ...state, step: 'connected', paired: true, connected: true, in_progress: false },
      false
    )
  ).toBe('success');
  expect(
    frameStatus({
      ...state,
      step: 'offline',
      paired: true,
      in_progress: false,
      companion_installed: true,
      installed_version: '0.2.0',
    })
  ).toBe('offline');
  expect(
    pairingPage(
      { ...state, step: 'offline', paired: true, in_progress: false, error: 'offline' },
      false
    )
  ).toBe('success');
});

it('retains cleanup and trust failures across reopening', () => {
  expect(pairingPage({ ...state, step: 'installing', cancelling: true }, false)).toBe('cancelling');
  expect(
    pairingPage(
      {
        ...state,
        in_progress: false,
        step: 'failed',
        error: 'remote_operation',
        cleanup_pending: true,
      },
      true
    )
  ).toBe('cleanupFailed');
  for (const error of [
    'wrong_device',
    'host_key_changed',
    'certificate_changed',
    'identity_unverified',
    'protocol_mismatch',
    'companion_authentication_failed',
  ] as const) {
    expect(
      pairingPage(
        { ...state, in_progress: false, step: 'failed', error, access_verified: true },
        false
      )
    ).toBe('error');
  }
  expect(
    pairingPage(
      {
        ...state,
        in_progress: false,
        step: 'failed',
        error: 'remote_operation',
        access_verified: true,
      },
      false
    )
  ).toBe('setupFailed');
});

it('keeps remote removal separate from forgetting and removes only finished records', () => {
  expect(frameStatus({ ...state, step: 'forgotten', in_progress: true })).not.toBe('notPaired');
  expect(frameStatus({ ...state, step: 'forgotten', in_progress: false })).toBe('notPaired');
  expect(
    frameStatus({
      ...state,
      paired: true,
      connected: true,
      in_progress: false,
      maintenance_error: 'remote_operation',
    })
  ).toBe('updateFailed');
  expect(
    frameStatus({
      ...state,
      paired: true,
      in_progress: false,
      repair_needed: true,
      companion_installed: false,
    })
  ).toBe('repairNeeded');
  expect(
    removedPairing({
      ...state,
      in_progress: false,
      step: 'failed',
      remote_removal_performed: true,
      error: 'persistence',
      cleanup_pending: true,
    })
  ).toBe(false);
  expect(
    pairingPage(
      {
        ...state,
        in_progress: false,
        step: 'failed',
        remote_removal_performed: true,
        error: 'persistence',
        cleanup_pending: true,
      },
      false
    )
  ).toBe('cleanupFailed');
});

it('offers explicit approval when saved access is revoked without bypassing trust failures', () => {
  expect(
    pairingPage(
      {
        ...state,
        action: 'repair',
        step: 'installing',
        maintenance_error: 'companion_authentication_failed',
      },
      false
    )
  ).toBe('setup');
  for (const [error, status] of [
    ['authentication_failed', 'accessLost'],
    ['host_key_changed', 'identityChanged'],
    ['protocol_mismatch', 'incompatible'],
    ['companion_authentication_failed', 'helperAccessLost'],
  ] as const) {
    expect(
      frameStatus({
        ...state,
        paired: true,
        in_progress: false,
        error: 'offline',
        maintenance_error: error,
      })
    ).toBe(status);
  }
  expect(
    pairingPage(
      {
        ...state,
        step: 'offline',
        paired: true,
        in_progress: false,
        error: 'offline',
        maintenance_error: 'authentication_failed',
      },
      false
    )
  ).toBe('accessLost');
  expect(
    pairingPage(
      {
        ...state,
        access_verified: true,
        in_progress: false,
        step: 'failed',
        error: 'authentication_failed',
      },
      false
    )
  ).toBe('accessLost');
  expect(
    pairingPage(
      { ...state, access_verified: true, in_progress: false, step: 'failed', error: 'denied' },
      false
    )
  ).toBe('declined');
  expect(
    pairingPage({ ...state, access_verified: true, action: 'retry', step: 'verifying_ssh' }, false)
  ).toBe('setup');
});
