import { describe, expect, it } from 'vitest';
import { parseChangelog } from './changelog';

const CHANGELOG = `# Changelog

Intro text with a [link](https://example.com).

- An intro bullet that is not a release

## [Unreleased]

### Fixed

- A fix with \`code\`

### Added

- A feature
  - A detail of the feature
- Another feature by [someone](https://github.com/someone)

## [25.6.6]

### Changes

- Various dependency upgrades

## [25.6.5]

### Removed
`;

describe('parseChangelog', () => {
  const releases = parseChangelog(CHANGELOG);

  it('skips the intro and releases without entries', () => {
    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '25.6.6']);
    expect(releases[0].unreleased).toBe(true);
    expect(releases[1].unreleased).toBe(false);
  });

  it('orders sections by kind and maps heading variants', () => {
    expect(releases[0].sections.map((s) => s.kind)).toEqual(['added', 'fixed']);
    expect(releases[1].sections.map((s) => s.kind)).toEqual(['changed']);
  });

  it('keeps nested items and renders inline markdown', () => {
    const [feature, another] = releases[0].sections[0].items;
    expect(feature.html).toBe('A feature');
    expect(feature.children.map((c) => c.html)).toEqual(['A detail of the feature']);
    expect(another.html).toBe(
      'Another feature by <a target="_blank" href="https://github.com/someone">someone</a>'
    );
    expect(releases[0].sections[1].items[0].html).toBe('A fix with <code>code</code>');
  });
});
