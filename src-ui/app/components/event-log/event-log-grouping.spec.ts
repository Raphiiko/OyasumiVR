import { describe, expect, it } from 'vitest';
import { EVENT_LOG_GROUP_GAP, groupEventLog } from './event-log-grouping';
import type { EventLogEntry } from '../../models/event-log-entry';

let nextId = 0;
const entry = (time: number, fields: Record<string, unknown>) =>
  ({ id: `e${nextId++}`, time, ...fields }) as unknown as EventLogEntry;
const sleepOn = (time: number) =>
  entry(time, { type: 'sleepModeEnabled', reason: { type: 'MANUAL' } });
const gpu = (time: number, reason = 'SLEEP_MODE_ENABLED') =>
  entry(time, { type: 'gpuPowerLimitChanged', reason });
const brightness = (time: number, reason = 'SLEEP_MODE_ENABLE') =>
  entry(time, { type: 'hardwareBrightnessChanged', reason });
const shutdown = (time: number) =>
  entry(time, { type: 'shutdownSequenceStarted', reason: 'SLEEP_TRIGGER' });
const sleepOff = (time: number) =>
  entry(time, { type: 'sleepModeDisabled', reason: { type: 'MANUAL' } });
const invite = (time: number) =>
  entry(time, { type: 'declinedInvite', reason: 'SLEEP_MODE_ENABLED' });

describe('groupEventLog', () => {
  it('folds the effects of a sleep mode change under its trigger', () => {
    const trigger = sleepOn(1000);
    const effects = [gpu(3000), brightness(2000)];
    const [group] = groupEventLog([...effects, trigger]);
    expect(group).toEqual({
      kind: 'group',
      id: trigger.id,
      cause: 'sleepModeEnabled',
      trigger,
      entries: effects,
    });
  });

  it('keeps unrelated entries in place around a group', () => {
    const items = groupEventLog([gpu(3000), invite(2500), brightness(2000), sleepOn(1000)]);
    expect(items.map((item) => item.kind)).toEqual(['group', 'entry']);
    expect(items[0].kind === 'group' && items[0].entries).toHaveLength(2);
  });

  it('closes a group at its trigger', () => {
    const olderEffect = gpu(500);
    const items = groupEventLog([gpu(2000), sleepOn(1000), olderEffect]);
    expect(items[1]).toEqual({ kind: 'entry', id: olderEffect.id, entry: olderEffect });
  });

  it('splits members further apart than the gap', () => {
    const items = groupEventLog([gpu(EVENT_LOG_GROUP_GAP + 2000), gpu(1000), brightness(900)]);
    expect(items.map((item) => item.kind)).toEqual(['entry', 'group']);
  });

  it('groups effects without a trigger', () => {
    const [group] = groupEventLog([
      gpu(2000, 'SLEEP_PREPARATION'),
      brightness(1000, 'SLEEP_PREPARATION'),
    ]);
    expect(group).toMatchObject({ kind: 'group', cause: 'sleepPreparation' });
    expect(group.kind === 'group' && group.trigger).toBeUndefined();
  });

  it('leaves a lone trigger ungrouped', () => {
    const trigger = sleepOn(1000);
    expect(groupEventLog([trigger])).toEqual([{ kind: 'entry', id: trigger.id, entry: trigger }]);
  });

  it('folds a shutdown started by sleep mode into its group', () => {
    const [group] = groupEventLog([shutdown(20000), gpu(2000), sleepOn(1000)]);
    expect(group.kind === 'group' && group.entries).toHaveLength(2);
  });

  it('keeps bursts apart when their triggers are hidden', () => {
    const later = [gpu(40000, 'SLEEP_MODE_DISABLED'), brightness(40000, 'SLEEP_MODE_DISABLE')];
    const earlier = [gpu(5000, 'SLEEP_MODE_DISABLED'), brightness(5000, 'SLEEP_MODE_DISABLE')];
    const items = groupEventLog(
      [...later, sleepOff(39000), ...earlier, sleepOff(4000)],
      ['sleepModeDisabled']
    );
    expect(items).toMatchObject([
      { kind: 'group', entries: later },
      { kind: 'group', entries: earlier },
    ]);
    expect(items.every((item) => item.kind === 'group' && !item.trigger)).toBe(true);
  });

  it('drops hidden entries and unwraps what is left', () => {
    const effect = gpu(2000);
    const items = groupEventLog(
      [effect, brightness(1500), sleepOn(1000)],
      ['sleepModeEnabled', 'hardwareBrightnessChanged']
    );
    expect(items).toEqual([{ kind: 'entry', id: effect.id, entry: effect }]);
  });
});
