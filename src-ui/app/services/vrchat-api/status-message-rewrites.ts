import { vrcStatusMessagesMatch } from 'src-ui/app/utils/status-utils';

const CONFIRMATIONS_NEEDED = 3;

/** Learns how VRChat stores a status message it rewrites in a way the fold does not cover. */
export class StatusMessageRewrites {
  private readonly learned = new Map<string, string>();
  /** The rewrite seen in the most recent PUT responses; any other response resets it. */
  private streak: { sent: string; stored: string; count: number } | null = null;

  public matches(sent: string, stored: string): boolean {
    return vrcStatusMessagesMatch(sent, stored) || this.learned.get(sent) === stored;
  }

  /** Returns true once, when the same rewrite has come back CONFIRMATIONS_NEEDED times in a row. */
  public record(sent: string, stored: string): boolean {
    if (this.matches(sent, stored)) {
      this.streak = null;
      return false;
    }

    // count identical rewrites in a row
    const continues = this.streak?.sent === sent && this.streak.stored === stored;
    this.streak = { sent, stored, count: continues ? this.streak!.count + 1 : 1 };
    if (this.streak.count < CONFIRMATIONS_NEEDED) return false;

    // learn the stored form
    this.learned.set(sent, stored);
    this.streak = null;
    return true;
  }
}
