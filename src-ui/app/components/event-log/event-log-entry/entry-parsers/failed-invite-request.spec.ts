import { describe, expect, it, vi } from 'vitest';
import type { EventLogFailedInviteRequest } from '../../../../models/event-log-entry';
import { EventLogFailedInviteRequestEntryParser } from './failed-invite-request';

vi.mock('../event-log-entry-parser', () => ({ EventLogEntryParser: class {} }));

describe('EventLogFailedInviteRequestEntryParser', () => {
  it('escapes the text from VRChat and the sender', () => {
    const parser = new EventLogFailedInviteRequestEntryParser();
    const entry = {
      type: 'failedInviteRequest',
      displayName: '<b>Bob</b>',
      vrchatMessage: '<img src=x onerror=alert(1)>',
    } as EventLogFailedInviteRequest;
    expect(parser.headerInfoTitleParams(entry).displayName).toBe('&lt;b&gt;Bob&lt;/b&gt;');
    expect(parser.headerInfoSubTitleParams(entry).message).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });
});
