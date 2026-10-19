export const MINUTES_PER_DAY = 24 * 60;

/** Reads `HH:mm`, `HHmm`, `H`, `H.mm` or a 12-hour time such as `9:30 pm`; null when unreadable. */
export function parseTime(text: string): [number, number] | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d{1,2})(?:[:.h ]?(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.[0];
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return [hours, minutes];
}

export function formatTime(hours: number, minutes: number): string {
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}
