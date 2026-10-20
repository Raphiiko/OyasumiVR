import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { VRChatMicMuteAutomationService } from './vrchat-mic-mute-automation.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('../vrchat-api/vrchat.service', () => ({ VRChatService: class {} }));

type Args = ConstructorParameters<typeof VRChatMicMuteAutomationService>;

function createService(muted: boolean | null) {
  const osc = { send_int: vi.fn(), vrchatOscQueryAddress: new BehaviorSubject(null) };
  const eventLog = { logEvent: vi.fn() };
  const service = new VRChatMicMuteAutomationService(
    osc as unknown as Args[0],
    {} as Args[1],
    {} as Args[2],
    {} as Args[3],
    eventLog as unknown as Args[4],
    {} as Args[5]
  );
  const internals = service as unknown as {
    vrcActive: boolean;
    _muted: BehaviorSubject<boolean | null>;
    applyAutomation(option: string, reason: string): Promise<void>;
  };
  internals.vrcActive = true;
  internals._muted.next(muted);
  return { internals, osc, eventLog };
}

describe('VRChatMicMuteAutomationService', () => {
  it('logs a failure and sends no toggle while OSCQuery cannot report the state', async () => {
    const { internals, osc, eventLog } = createService(null);

    await internals.applyAutomation('MUTE', 'SLEEP_MODE_ENABLED');

    expect(osc.send_int).not.toHaveBeenCalled();
    expect(eventLog.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ muted: true, failure: 'STATE_UNKNOWN' })
    );
  });

  it('toggles when the known state differs from the target', async () => {
    const { internals, osc, eventLog } = createService(false);

    await internals.applyAutomation('MUTE', 'SLEEP_MODE_ENABLED');

    expect(osc.send_int).toHaveBeenCalled();
    expect(eventLog.logEvent.mock.calls[0][0].failure).toBeUndefined();
  });
});
