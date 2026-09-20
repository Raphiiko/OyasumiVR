import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AwaitableEventSource } from '../../utils/awaitable-event';
import { OSC_SCRIPT_VERSION, OscScript } from '../../models/osc-script';
import { OscGeneralAutomationsService } from './osc-general-automations.service';

const script: OscScript = { version: OSC_SCRIPT_VERSION, commands: [] };

describe('OscGeneralAutomationsService', () => {
  it('runs once per sleep action and waits for queued completion', async () => {
    const actions = new AwaitableEventSource<{ mode: boolean; reason: never }>();
    const configs = new BehaviorSubject({
      OSC_GENERAL: { enabled: true, onSleepModeEnable: script },
    });
    let finish!: () => void;
    const queueScript = vi.fn(
      () =>
        new Promise<{ result: undefined }>((resolve) => {
          finish = () => resolve({ result: undefined });
        })
    );
    const service = new OscGeneralAutomationsService(
      { configs } as never,
      { onSleepModeChangeActions: actions.event } as never,
      { queueScript } as never,
      { onSleepPreparation: new Subject<void>() } as never
    );

    await service.init();
    expect(queueScript).not.toHaveBeenCalled();

    let settled = false;
    const emission = actions.emit({ mode: true, reason: undefined as never }).then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(queueScript).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    finish();
    await emission;
    expect(settled).toBe(true);
  });

  it('reports a queued script failure', async () => {
    const actions = new AwaitableEventSource<{ mode: boolean; reason: never }>();
    const configs = new BehaviorSubject({
      OSC_GENERAL: { enabled: true, onSleepModeDisable: script },
    });
    const service = new OscGeneralAutomationsService(
      { configs } as never,
      { onSleepModeChangeActions: actions.event } as never,
      { queueScript: vi.fn().mockResolvedValue({ error: 'cancelled' }) } as never,
      { onSleepPreparation: new Subject<void>() } as never
    );
    await service.init();

    const [result] = await actions.emit({ mode: false, reason: undefined as never });

    expect(result).toEqual({ status: 'rejected', reason: 'cancelled' });
  });
});
