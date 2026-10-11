import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

const RECENT_CODE_DURATION_MS = 15 * 60 * 1000;

/** Keeps the last report code for a while, so a user who closed the dialog can still find it. */
@Injectable({
  providedIn: 'root',
})
export class DebugReportService {
  /** The last report code, or null when there is none or it is older than 15 minutes. */
  public readonly recentCode = new BehaviorSubject<string | null>(null);
  private expiry?: ReturnType<typeof setTimeout>;

  setRecentCode(code: string) {
    clearTimeout(this.expiry);
    this.recentCode.next(code);
    this.expiry = setTimeout(() => this.recentCode.next(null), RECENT_CODE_DURATION_MS);
  }
}
