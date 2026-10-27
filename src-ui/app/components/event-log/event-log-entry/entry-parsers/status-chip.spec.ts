import { describe, expect, it } from 'vitest';
import { UserStatus } from '../../../../models/vrchat';
import { statusChangeChipHtml } from './status-chip';

describe('statusChangeChipHtml', () => {
  it('escapes status messages', () => {
    const html = statusChangeChipHtml(
      UserStatus.Active,
      '<img src=x onerror=alert(1)>',
      UserStatus.Busy,
      'a & "b"'
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('a &amp; &quot;b&quot;');
  });

  it('falls back to the status name when the message is empty', () => {
    expect(statusChangeChipHtml(UserStatus.Active, '', UserStatus.AskMe, ' ')).toContain(
      '<span class="status-label">Ask Me</span>'
    );
  });
});
