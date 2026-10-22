import { describe, expect, it } from 'vitest';
import { StatusMessageRewrites } from './status-message-rewrites';

describe('StatusMessageRewrites', () => {
  it('learns a rewrite after three identical responses in a row', () => {
    const rewrites = new StatusMessageRewrites();
    expect(rewrites.record('a...', 'a…')).toBe(false);
    expect(rewrites.record('a...', 'a…')).toBe(false);
    expect(rewrites.matches('a...', 'a…')).toBe(false);
    expect(rewrites.record('a...', 'a…')).toBe(true);
    expect(rewrites.matches('a...', 'a…')).toBe(true);
  });

  it('restarts the count when a different response comes in between', () => {
    const rewrites = new StatusMessageRewrites();
    rewrites.record('a...', 'a…');
    rewrites.record('a...', 'a…');
    rewrites.record('a...', 'a..');
    rewrites.record('a...', 'a…');
    expect(rewrites.record('a...', 'a…')).toBe(false);
    expect(rewrites.matches('a...', 'a…')).toBe(false);
  });

  it('restarts the count when VRChat stores the message as sent', () => {
    const rewrites = new StatusMessageRewrites();
    rewrites.record('a...', 'a…');
    rewrites.record('a...', 'a…');
    expect(rewrites.record('a...', 'a...')).toBe(false);
    expect(rewrites.record('a...', 'a…')).toBe(false);
  });

  it('ignores rewrites the fold already covers', () => {
    const rewrites = new StatusMessageRewrites();
    for (let i = 0; i < 3; i++) expect(rewrites.record('a.', 'a․')).toBe(false);
  });

  it('keeps a learned rewrite tied to the message that was sent', () => {
    const rewrites = new StatusMessageRewrites();
    for (let i = 0; i < 3; i++) rewrites.record('a...', 'a…');
    expect(rewrites.matches('b...', 'a…')).toBe(false);
  });
});
