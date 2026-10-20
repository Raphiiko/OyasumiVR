import { describe, expect, it } from 'vitest';
import en from '../../../../assets/i18n/en.json';

// these entry types never log a failure, so their titles need no _FAILED sibling
const NEVER_FAILS = [
  'acceptedInviteRequest',
  'bsbFanSpeedChanged',
  'bsbLedChanged',
  'cctChanged',
  'changedSystemMicControllerButtonBehavior',
  'hardwareBrightnessChanged',
  'shutdownSequenceCancelled',
  'shutdownSequenceStarted',
  'simpleBrightnessChanged',
  'sleepDetectorEnableCancelled',
  'sleepModeDisabled',
  'sleepModeEnabled',
  'softwareBrightnessChanged',
];

describe('event log titles', () => {
  it('give every title of an entry type that can fail a _FAILED sibling', () => {
    const types = en.comp['event-log-entry'].type as Record<string, { title?: unknown }>;
    const missing: string[] = [];
    for (const [type, entry] of Object.entries(types)) {
      if (NEVER_FAILS.includes(type) || entry.title === undefined) continue;
      if (typeof entry.title === 'string') {
        if (!('title_FAILED' in entry)) missing.push(`${type}.title`);
        continue;
      }
      const titles = entry.title as Record<string, string>;
      for (const key of Object.keys(titles)) {
        if (!key.endsWith('_FAILED') && !(`${key}_FAILED` in titles)) {
          missing.push(`${type}.title.${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
