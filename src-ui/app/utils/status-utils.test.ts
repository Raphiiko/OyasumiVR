import { describe, expect, it } from 'vitest';
import { describeVRChatTextRewrite, foldVRChatText, vrcStatusMessagesMatch } from './status-utils';

describe('foldVRChatText', () => {
  it('maps every VRChat substitute back to its ASCII character', () => {
    const stored = '＠＃＄％＆＝＋⁄＼;˸‚？ǃ＂≺≻․＾｛｝［］（）｜∗';
    expect(foldVRChatText(stored)).toBe('@#$%&=+/\\;:,?!"<>.^{}[]()|*');
  });

  it('collapses and trims whitespace', () => {
    expect(foldVRChatText('  a   b  ')).toBe('a b');
  });
});

describe('vrcStatusMessagesMatch', () => {
  it('matches a message against the form VRChat stores', () => {
    expect(vrcStatusMessagesMatch('Sleeping come cuddle up.', 'Sleeping come cuddle up․')).toBe(
      true
    );
  });

  it('keeps messages apart that differ in more than substitutes', () => {
    expect(vrcStatusMessagesMatch('Sleeping.', 'Sleeping!')).toBe(false);
    expect(vrcStatusMessagesMatch('Sleeping', 'sleeping')).toBe(false);
  });
});

describe('describeVRChatTextRewrite', () => {
  it('reports a merge of several characters into one', () => {
    expect(describeVRChatTextRewrite('zzz...', 'zzz…')).toBe('U+002E U+002E U+002E>U+2026');
  });

  it('reports each changed span apart', () => {
    expect(describeVRChatTextRewrite('~zzz~', '〜zzz〜')).toBe('U+007E>U+301C, U+007E>U+301C');
  });

  it('reports removed and added characters', () => {
    expect(describeVRChatTextRewrite('zzz~', 'zzz')).toBe('U+007E>-');
    expect(describeVRChatTextRewrite('zzz', 'zzz~')).toBe('->U+007E');
  });

  it('leaves out the content of a span with letters or digits', () => {
    expect(describeVRChatTextRewrite('call me 123', 'call me ***')).toBe('text(3>3)');
    expect(describeVRChatTextRewrite('bad word', '*** word')).toBe('text(3>3)');
  });

  it('ignores differences the fold covers', () => {
    expect(describeVRChatTextRewrite('zzz. (a)', 'zzz․ （a）')).toBe('');
  });
});
