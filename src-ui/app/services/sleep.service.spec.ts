import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SleepService } from './sleep.service';
import type { OpenVRService } from './openvr.service';
import type { OVRDevice, OVRDevicePose } from '../models/ovr-device';
import type { SleepingPose } from '../models/sleeping-pose';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

const hmd: OVRDevice = {
  index: 0,
  class: 'HMD',
  role: 'Invalid',
  battery: 0,
  pose: null,
  isTurningOff: false,
};
const pose: OVRDevicePose = { quaternion: [0, 0, 0, 1], position: [0, 0, 0] };

function setup() {
  const devices = new BehaviorSubject<OVRDevice[]>([hmd]);
  const devicePoses = new BehaviorSubject<Record<number, OVRDevicePose>>({});
  const service = new SleepService(
    { devices, devicePoses } as unknown as OpenVRService,
    undefined!,
    undefined!,
    undefined!,
    undefined!
  );
  const classify = vi
    .spyOn(
      service as unknown as { getSleepingPoseForDevicePose: (p: OVRDevicePose) => SleepingPose },
      'getSleepingPoseForDevicePose'
    )
    .mockReturnValue('SIDE_LEFT');
  return { service, classify, emit: () => devicePoses.next({ 0: pose }) };
}

describe('shared sleeping pose', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('classifies once per update for startup and view subscribers', () => {
    const { service, classify, emit } = setup();
    const consumers = Array.from({ length: 5 }, () => vi.fn());
    const subscriptions = consumers.map((consumer) => service.pose.subscribe(consumer));
    consumers.forEach((consumer) => expect(consumer).toHaveBeenLastCalledWith('UNKNOWN'));
    emit();
    expect(classify).toHaveBeenCalledTimes(1);
    emit();
    vi.advanceTimersByTime(1000);
    expect(classify).toHaveBeenCalledTimes(2);
    consumers.forEach((consumer) =>
      expect(consumer.mock.calls).toEqual([['UNKNOWN'], ['SIDE_LEFT']])
    );
    const late = vi.fn();
    const lateSubscription = service.pose.subscribe(late);
    expect(late.mock.calls).toEqual([['SIDE_LEFT']]);
    expect(classify).toHaveBeenCalledTimes(2);
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    lateSubscription.unsubscribe();
    emit();
    expect(classify).toHaveBeenCalledTimes(3);
    const reopened = service.pose.subscribe(late);
    expect(late).toHaveBeenLastCalledWith('SIDE_LEFT');
    expect(classify).toHaveBeenCalledTimes(3);
    reopened.unsubscribe();
  });

  it('shares the stability window and broadcasts forced poses', () => {
    const { service, classify, emit } = setup();
    const first = vi.fn();
    const a = service.pose.subscribe(first);
    emit();
    vi.advanceTimersByTime(500);
    const second = vi.fn();
    const b = service.pose.subscribe(second);
    emit();
    vi.advanceTimersByTime(500);
    expect(first).toHaveBeenLastCalledWith('SIDE_LEFT');
    expect(second).toHaveBeenLastCalledWith('SIDE_LEFT');
    service.forcePose('SIDE_BACK');
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    expect(second).toHaveBeenLastCalledWith('SIDE_BACK');
    classify.mockReturnValueOnce('SIDE_LEFT').mockReturnValueOnce('SIDE_RIGHT');
    emit();
    emit();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    emit();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenLastCalledWith('SIDE_BACK');
    a.unsubscribe();
    b.unsubscribe();
  });
});
