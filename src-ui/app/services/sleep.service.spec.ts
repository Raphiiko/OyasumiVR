import type { NgZone } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { SleepService } from './sleep.service';
import type { AppSettingsService } from './app-settings.service';
import type { SleepingPose } from '../models/sleeping-pose';

const core = vi.hoisted(() => ({
  pose: 'UNKNOWN' as SleepingPose,
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  /** Runs while sleeping_pose_get is in flight, after the core read its answer. */
  beforeGetResolves: undefined as (() => void) | undefined,
}));

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    core.listeners.set(name, handler);
    return () => {};
  }),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (command: string, args?: { pose: SleepingPose }) => {
    if (command === 'sleeping_pose_get') {
      const pose = core.pose;
      core.beforeGetResolves?.();
      return pose;
    }
    if (command === 'sleeping_pose_force') {
      core.pose = args!.pose;
      core.listeners.get('sleeping-pose-update-event')!({ payload: core.pose });
    }
  }),
}));

function createService() {
  const appSettings = { settings: of({ sleepModeStartupBehaviour: 'INACTIVE' }) };
  const zone = { run: vi.fn((fn: () => unknown) => fn()) };
  const service = new SleepService(
    undefined!,
    undefined!,
    appSettings as unknown as AppSettingsService,
    undefined!,
    zone as unknown as NgZone
  );
  return { service, zone };
}

describe('sleeping pose from the core', () => {
  it('catches up on the pose detected before init and follows updates', async () => {
    core.pose = 'SIDE_BACK';
    const { service, zone } = createService();
    const poses: SleepingPose[] = [];
    service.pose.subscribe((pose) => poses.push(pose));
    await service.init();
    core.listeners.get('sleeping-pose-update-event')!({ payload: 'SIDE_LEFT' });
    core.listeners.get('sleeping-pose-update-event')!({ payload: 'SIDE_LEFT' });
    expect(poses).toEqual(['UNKNOWN', 'SIDE_BACK', 'SIDE_LEFT']);
    expect(zone.run).toHaveBeenCalledTimes(2);
  });

  it('keeps an update that arrives before the catch-up answer', async () => {
    core.pose = 'SIDE_BACK';
    core.beforeGetResolves = () => {
      core.pose = 'SIDE_LEFT';
      core.listeners.get('sleeping-pose-update-event')!({ payload: core.pose });
    };
    const { service } = createService();
    const poses: SleepingPose[] = [];
    service.pose.subscribe((pose) => poses.push(pose));
    await service.init();
    core.beforeGetResolves = undefined;
    expect(poses).toEqual(['UNKNOWN', 'SIDE_LEFT']);
  });

  it('forces a pose through the core', async () => {
    core.pose = 'UNKNOWN';
    const { service } = createService();
    await service.init();
    const late: SleepingPose[] = [];
    await service.forcePose('SIDE_RIGHT');
    service.pose.subscribe((pose) => late.push(pose));
    expect(late).toEqual(['SIDE_RIGHT']);
  });
});
