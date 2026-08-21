//
// Test doubles for the Tauri commands and plugins the settings code calls.
//

const PREFIX = 'DPAPI:';

export const fakeTauri = {
  protectCalls: 0,
  unprotectCalls: 0,
  failProtect: false,
  failUnprotect: false,
  logs: [] as string[],
  backups: [] as { path: string; contents: string }[],
  dialogs: [] as string[],

  reset() {
    this.protectCalls = 0;
    this.unprotectCalls = 0;
    this.failProtect = false;
    this.failUnprotect = false;
    this.logs = [];
    this.backups = [];
    this.dialogs = [];
  },

  // A different value every time, like the real CryptProtectData
  protect(secret: string): string {
    this.protectCalls++;
    if (this.failProtect) throw new Error('protect failed');
    return `${PREFIX}${this.protectCalls}:${btoa(unescape(encodeURIComponent(secret)))}`;
  },

  unprotect(stored: string): string {
    this.unprotectCalls++;
    if (this.failUnprotect) throw new Error('unprotect failed');
    if (!stored.startsWith(PREFIX)) throw new Error('The parameter is incorrect');
    const payload = stored.slice(stored.indexOf(':', PREFIX.length) + 1);
    return decodeURIComponent(escape(atob(payload)));
  },

  isProtected(value: unknown): boolean {
    return typeof value === 'string' && value.startsWith(PREFIX);
  },

  logsMatching(fragment: string): string[] {
    return this.logs.filter((line) => line.includes(fragment));
  },
};
