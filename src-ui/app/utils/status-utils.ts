import { UserStatus } from '../models/vrchat';

export function vrcStatusToString(status: UserStatus): string {
  switch (status) {
    case UserStatus.Active:
      return 'Online';
    case UserStatus.JoinMe:
      return 'Join Me';
    case UserStatus.AskMe:
      return 'Ask Me';
    case UserStatus.Busy:
      return 'Do Not Disturb';
    case UserStatus.Offline:
      return 'Offline';
    default:
      return 'Unknown';
  }
}

// VRChat stores each character of the first string in place of the ASCII character at the same index.
const VRCHAT_SUBSTITUTES = '＠＃＄％＆＝＋⁄＼;˸‚？ǃ＂≺≻․＾｛｝［］（）｜∗';
const VRCHAT_SUBSTITUTED_ASCII = '@#$%&=+/\\;:,?!"<>.^{}[]()|*';
const VRCHAT_SUBSTITUTE_PATTERN = new RegExp(`[${VRCHAT_SUBSTITUTES}]`, 'g');

/** Reverses VRChat's punctuation substitutes and collapses whitespace, for comparing messages. */
export function foldVRChatText(text: string | undefined): string {
  return (text ?? '')
    .replace(VRCHAT_SUBSTITUTE_PATTERN, (char) =>
      VRCHAT_SUBSTITUTED_ASCII.charAt(VRCHAT_SUBSTITUTES.indexOf(char))
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function vrcStatusMessagesMatch(a: string | undefined, b: string | undefined): boolean {
  return foldVRChatText(a) === foldVRChatText(b);
}

/**
 * Lists each changed span between two folded messages as code points, such as
 * `U+002E U+002E>U+2026`. A span with any character outside punctuation, spaces, and math,
 * currency, or modifier symbols shows only its lengths, `text(2>3)`.
 */
export function describeVRChatTextRewrite(sent: string, stored: string): string {
  return diffCodePoints(Array.from(foldVRChatText(sent)), Array.from(foldVRChatText(stored)))
    .map(({ sent, stored }) => {
      if (![...sent, ...stored].every((char) => REPORTABLE_CHAR.test(char))) {
        return `text(${sent.length}>${stored.length})`;
      }
      return `${formatCodePoints(sent)}>${formatCodePoints(stored)}`;
    })
    .join(', ');
}

// letter-like symbols such as circled letters are So, so the allowlist leaves out every other class
const REPORTABLE_CHAR = /^[\p{P}\p{Z}\p{Sm}\p{Sc}\p{Sk}]$/u;

function formatCodePoints(chars: string[]): string {
  if (!chars.length) return '-';
  return chars
    .map((c) => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'))
    .join(' ');
}

/** Splits the difference into changed spans along a longest common subsequence. */
function diffCodePoints(a: string[], b: string[]): { sent: string[]; stored: string[] }[] {
  // build the common subsequence lengths from the end
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // walk both strings and group the unmatched characters into spans
  const spans: { sent: string[]; stored: string[] }[] = [];
  let span: { sent: string[]; stored: string[] } | null = null;
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      span = null;
      i++;
      j++;
      continue;
    }
    if (!span) {
      span = { sent: [], stored: [] };
      spans.push(span);
    }
    if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      span.stored.push(b[j++]);
    } else {
      span.sent.push(a[i++]);
    }
  }
  return spans;
}
