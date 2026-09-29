import { marked, Tokens } from 'marked';

export type ChangelogSectionKind = 'added' | 'changed' | 'fixed' | 'removed' | 'other';

export interface ChangelogItem {
  html: string;
  children: ChangelogItem[];
}

export interface ChangelogSection {
  kind: ChangelogSectionKind;
  items: ChangelogItem[];
}

export interface ChangelogRelease {
  version: string;
  unreleased: boolean;
  sections: ChangelogSection[];
}

const SECTION_ORDER: ChangelogSectionKind[] = ['added', 'changed', 'fixed', 'removed', 'other'];

/** Parses a Keep a Changelog document into releases, newest first. Text before the first release is dropped. */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | undefined;
  let section: ChangelogSection | undefined;

  for (const token of marked.lexer(markdown)) {
    // start a release on every level 2 heading
    if (token.type === 'heading' && token.depth === 2) {
      const version = token.text.replace(/^\[|\]$/g, '').trim();
      release = { version, unreleased: /^unreleased$/i.test(version), sections: [] };
      releases.push(release);
      section = undefined;
      continue;
    }
    if (!release) continue;

    // switch section on every level 3 heading, one section per kind
    if (token.type === 'heading' && token.depth === 3) {
      section = sectionOf(release, sectionKind(token.text));
      continue;
    }

    // collect list items into the current section
    if (token.type === 'list') {
      section ??= sectionOf(release, 'other');
      section.items.push(...parseList(token as Tokens.List));
    }
  }

  for (const r of releases) {
    r.sections = r.sections
      .filter((s) => s.items.length)
      .sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind));
  }
  return releases.filter((r) => r.sections.length);
}

function sectionOf(release: ChangelogRelease, kind: ChangelogSectionKind): ChangelogSection {
  let section = release.sections.find((s) => s.kind === kind);
  if (!section) {
    section = { kind, items: [] };
    release.sections.push(section);
  }
  return section;
}

function sectionKind(title: string): ChangelogSectionKind {
  const normalized = title.trim().toLowerCase();
  if (normalized.startsWith('add')) return 'added';
  if (normalized.startsWith('change')) return 'changed';
  if (normalized.startsWith('fix')) return 'fixed';
  if (normalized.startsWith('remove')) return 'removed';
  return 'other';
}

function parseList(list: Tokens.List): ChangelogItem[] {
  return list.items.map((item) => {
    const text = item.tokens
      .filter((t) => t.type !== 'list')
      .map((t) => ('text' in t ? t.text : t.raw))
      .join(' ');
    const children = item.tokens
      .filter((t): t is Tokens.List => t.type === 'list')
      .flatMap((t) => parseList(t));
    const html = (marked.parseInline(text) as string).replace(/<a /g, '<a target="_blank" ');
    return { html, children };
  });
}
