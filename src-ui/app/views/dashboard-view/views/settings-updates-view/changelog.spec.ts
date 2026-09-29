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

## [25.6.4]

### Changed

- A change

### Deprecated

- A deprecation

### Changes

- Another change

### Security

- A security note
`;

describe('parseChangelog', () => {
  const releases = parseChangelog(CHANGELOG);

  it('skips the intro and releases without entries', () => {
    expect(releases.map((r) => r.version)).toEqual(['Unreleased', '25.6.6', '25.6.4']);
    expect(releases[0].unreleased).toBe(true);
    expect(releases[1].unreleased).toBe(false);
  });

  it('orders sections by kind and maps heading variants', () => {
    expect(releases[0].sections.map((s) => s.kind)).toEqual(['added', 'fixed']);
    expect(releases[1].sections.map((s) => s.kind)).toEqual(['changed']);
  });

  it('merges headings of the same kind into one section', () => {
    const sections = releases[2].sections;
    expect(sections.map((s) => s.kind)).toEqual(['changed', 'other']);
    expect(sections[0].items.map((i) => i.html)).toEqual(['A change', 'Another change']);
    expect(sections[1].items.map((i) => i.html)).toEqual(['A deprecation', 'A security note']);
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
