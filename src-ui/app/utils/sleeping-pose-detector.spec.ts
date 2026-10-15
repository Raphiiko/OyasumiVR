import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SleepingPoseDetector } from './sleeping-pose-detector';
import { SleepingPose } from '../models/sleeping-pose';

function headset(pitchDegrees: number, rollDegrees: number): [number, number, number, number] {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(pitchDegrees),
    0,
    THREE.MathUtils.degToRad(rollDegrees),
    'YXZ'
  );
  return new THREE.Quaternion().setFromEuler(euler).toArray() as [number, number, number, number];
}

describe('SleepingPoseDetector', () => {
  it.each<[string, number, number, SleepingPose]>([
    ['upright', 0, 0, 'SIDE_FRONT'],
    ['lying on the back', 75, 0, 'SIDE_BACK'],
    ['lying on the left side', 0, 90, 'SIDE_LEFT'],
    ['lying on the right side', 0, -90, 'SIDE_RIGHT'],
  ])('classifies a headset %s', (_, pitch, roll, expected) => {
    const detector = new SleepingPoseDetector();
    detector.processOrientation(headset(pitch, roll));
    expect(detector.sleepingPose).toBe(expected);
  });
});
