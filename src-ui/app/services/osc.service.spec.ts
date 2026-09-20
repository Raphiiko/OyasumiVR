import { describe, expect, it, vi } from 'vitest';
import { OscService } from './osc.service';
import { OSC_SCRIPT_VERSION } from '../models/osc-script';

vi.mock('@tauri-apps/plugin-log', () => ({ debug: vi.fn() }));

describe('OscService queueScript', () => {
  it('completes after the queued script sleep', async () => {
    vi.useFakeTimers();
    const service = new OscService({ settingsSync: { oscTargets: [] } } as never);
    let settled = false;

    const completion = service
      .queueScript({
        version: OSC_SCRIPT_VERSION,
        commands: [{ type: 'SLEEP', duration: 100 }],
      })
      .then((result) => {
        settled = true;
        return result;
      });
    await Promise.resolve();

    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(await completion).toEqual({ result: undefined });
    vi.useRealTimers();
  });
});
