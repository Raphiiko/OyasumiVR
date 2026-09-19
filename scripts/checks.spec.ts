import { describe, expect, it } from 'vitest';
import { checks, expandCheck } from './checks.mjs';
import { selectChecks } from './select-checks.mjs';
import { flattenCatalog, compareMessage, checkCatalogs } from './check-translations.mjs';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

describe('check selection', () => {
  it('builds consumers when a locale is deleted or contributor data changes', () => {
    expect(selectChecks(['src-ui/assets/i18n/ja.json'], () => false)).toContain('build:overlay-ui');
    expect(selectChecks(['docs/translation_contributors.json'])).toEqual(
      expect.arrayContaining(['format:web', 'test:web', 'build:ui', 'generated:readmes'])
    );
  });
  it('keeps locale-only edits out of builds and checks English test fixtures', () => {
    expect(selectChecks(['src-ui/assets/i18n/ja.json'])).toEqual(['format:web', 'translations']);
    expect(selectChecks(['src-ui/assets/i18n/en.json'])).toEqual([
      'format:web',
      'test:web',
      'translations',
    ]);
    for (const path of [
      'src-core/tauri.conf.json',
      'src-core/Cargo.toml',
      'src-elevated-sidecar/Cargo.toml',
      'src-privileged-launcher/Cargo.toml',
      'src-shared-rust/Cargo.toml',
    ])
      expect(selectChecks([path])).toContain('test:web');
  });
  it('checks both consumers of shared TypeScript', () => {
    expect(selectChecks(['src-shared-ts/src/util.ts'])).toEqual(
      expect.arrayContaining(['build:ui', 'build:overlay-ui', 'test:web'])
    );
    expect(selectChecks(['src-ui/app/app.component.ts'])).not.toContain('build:overlay-ui');
  });
  it('checks dependent Rust crates without unrelated components', () => {
    const selected = selectChecks(['src-shared-rust/src/lib.rs']);
    for (const name of ['core', 'shared-rust', 'elevated-sidecar', 'privileged-launcher'])
      expect(selected).toContain(`test:${name}`);
    expect(selected).not.toContain('build:memory-watch');
    expect(selected).not.toContain('build:ui');
  });
  it('checks protobuf consumers and generated README edits', () => {
    expect(selectChecks(['proto/oyasumi-core.proto'])).toEqual(
      expect.arrayContaining([
        'build:core',
        'build:elevated-sidecar',
        'build:overlay-sidecar',
        'build:ui',
        'build:overlay-ui',
      ])
    );
    expect(selectChecks(['docs/readmes/generated/README_JA.md'])).toEqual(['generated:readmes']);
  });
  it('runs everything for changed check code, dependencies, or unknown files', () => {
    for (const path of [
      'scripts/checks.mjs',
      'package-lock.json',
      '.github/workflows/checks.yml',
      'new-component/file.cpp',
    ])
      expect(selectChecks([path])).toEqual(Object.keys(checks));
    expect(selectChecks(['docs/agents/desktop-ui-testing.md'])).toEqual([]);
  });
  it('aggregates operations across components', () => {
    expect(expandCheck('format')).toEqual(
      expect.arrayContaining(['format:web', 'format:csharp', 'format:core', 'format:memory-watch'])
    );
    expect(expandCheck('build:rust')).toHaveLength(6);
    expect(expandCheck('all')).toEqual(Object.keys(checks));
    expect(() => expandCheck('imaginary')).toThrow('Unknown check');
  });
});

describe('translation contracts', () => {
  it('allows plural grammar inside markup while preserving number placement', () => {
    const en = '<b>{count, plural, one {1 device} other {# devices}}</b>';
    expect(compareMessage(en, '<b>{count} devices</b>', 'ja')).toEqual([]);
    expect(compareMessage(en, '{count}<b>devices</b>', 'ja')).toContain('markup');
  });
  it('rejects hidden arguments and empty nested links while allowing image links', () => {
    expect(compareMessage('Hello {name}', 'Hello <!-- {name} -->', 'en')).toContain('arguments');
    expect(
      compareMessage('<a href="/help"><b>Help</b></a>', '<a href="/help"><b></b></a>', 'en')
    ).toContain('markup');
    expect(
      compareMessage(
        '<a href="/help"><img src="help.png" alt="Help"></a>',
        '<a href="/help"><img src="help.png" alt="Aide"></a>',
        'fr'
      )
    ).toEqual([]);
  });
  it('checks formatter parameters, duplicate cases and cardinal versus ordinal selectors', () => {
    expect(compareMessage('{amount, number, {style}}', '{amount, number}', 'en')).toContain(
      'arguments'
    );
    expect(compareMessage('{amount, number, {style}}', '{amount, number, {style}}', 'en')).toEqual(
      []
    );
    expect(() =>
      compareMessage(
        '{state, select, on {<a href="/on">On</a>} other {Off}}',
        '{state, select, on {<a href="/on">On</a>} on {<a href="/wrong">Wrong</a>} other {Off}}',
        'en'
      )
    ).toThrow('duplicate ICU');
    expect(
      compareMessage(
        '{n, plural, one {# thing} other {# things}}',
        '{n, selectordinal, other {#}}',
        'en'
      )
    ).toContain('selections');
    expect(compareMessage('{n, selectordinal, one {#st} other {#th}}', '{n}', 'ja')).toEqual([]);
  });
  it('keeps arguments and links in their semantic branches', () => {
    expect(
      compareMessage(
        '{state, select, on {{name}} other {{name}}}',
        '{state, select, on {{name}} other {Off}}',
        'en'
      )
    ).toContain('arguments');
    for (const [source, target] of [
      [
        '{state, select, on {<a href="https://example.org">Help</a>} other {Off}}',
        '{state, select, on {On} other {<a href="https://example.org">Help</a>}}',
      ],
      [
        '{count, plural, =0 {<a href="https://example.org">Help</a>} other {#}}',
        '{count, plural, =0 {None} other {<a href="https://example.org">#</a>}}',
      ],
    ])
      expect(compareMessage(source, target, 'en')).toContain('markup');
    expect(
      compareMessage(
        '{count, plural, one {# device} other {# devices}}',
        '{count, plural, one {device} other {devices}}',
        'en'
      )
    ).toContain('arguments');
    expect(
      compareMessage('{count, plural, one {1 device} other {# devices}}', '{count} devices', 'ja')
    ).toEqual([]);
  });
  it('preserves HTML nesting, link labels, and attribute arguments', () => {
    for (const [source, target] of [
      ['<a href="https://example.org">{name}</a>', '{name}<a href="https://example.org"></a>'],
      ['<a href="https://example.org">Help</a>', 'Help<a href="https://example.org"></a>'],
      [
        '<a href="https://example.org"><img src="x"></a>',
        '<img src="x"><a href="https://example.org">Help</a>',
      ],
      ['<a title="{name}">Help</a>', '<a title="Help">{name}</a>'],
    ])
      expect(compareMessage(source, target, 'ja')).toContain('markup');
  });
  it('accepts reordered and repeated variables and locale-specific plural structure', () => {
    expect(
      compareMessage(
        '{name}: {count, plural, one {# device} other {# devices}}',
        '{count}台: {name} ({name})',
        'ja'
      )
    ).toEqual([]);
    expect(
      compareMessage(
        '{count, plural, one {# thing} other {# things}}',
        '{count, plural, one {# chose} many {# choses} other {# choses}}',
        'fr'
      )
    ).toEqual([]);
  });
  it('finds dropped, renamed, or extra arguments inside nested branches', () => {
    expect(compareMessage('{count, plural, other {{name}}}', '{count}', 'en')).toContain(
      'arguments'
    );
    expect(compareMessage('{name}', '{deviceName}', 'ja')).toContain('arguments');
    expect(compareMessage('{name}', '{name}{extra}', 'ja')).toContain('arguments');
  });
  it('preserves semantic choices and rejects malformed ICU', () => {
    expect(
      compareMessage('{state, select, on {On} other {Off}}', '{state, select, other {Off}}', 'en')
    ).toContain('selections');
    expect(() => compareMessage('{name}', '{name', 'ja')).toThrow();
    expect(compareMessage('{count, plural, =0 {None} other {#}}', '{count}', 'ja')).toContain(
      'selections'
    );
  });
  it('compares HTML and link attributes without comparing translated prose', () => {
    const en = '<a href="https://example.org/{id}" target="_blank" title="Help"><b>{name}</b></a>';
    expect(
      compareMessage(
        en,
        '<a title="ヘルプ" target="_blank" href="https://example.org/{id}"><b>{name}</b></a>',
        'ja'
      )
    ).toEqual([]);
    expect(
      compareMessage(
        en,
        '<a href="https://other.org/{id}" target="_blank" title="Help"><b>{name}</b></a>',
        'ja'
      )
    ).toContain('markup');
    expect(compareMessage('<b>{name}</b>', '{name}', 'ja')).toContain('markup');
    expect(() => compareMessage('{name}', '{name}</b>', 'ja')).toThrow();
    expect(() => compareMessage('<b>{name}</b>', '<b>{name}', 'ja')).toThrow();
  });
  it('uses the same flattened key ordering as tl clean', () => {
    expect(flattenCatalog({ 'a-b': { title: 'First' }, a: { title: 'Second' } })).toEqual({
      'a-b.title': 'First',
      'a.title': 'Second',
    });
    expect(() => flattenCatalog({ b: 'Second', a: 'First' })).toThrow('sorted');
    for (const value of ['', ' ', '{PLACEHOLDER}', null, [], {}, 5])
      expect(() => flattenCatalog({ a: value })).toThrow();
  });
  it('allows missing translations and rejects extra keys and missing arguments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oyasumi-catalog-test-'));
    const save = (locale, value) =>
      writeFileSync(join(directory, `${locale}.json`), JSON.stringify(value));
    try {
      save('en', { a: '{name}', b: 'Optional' });
      save('ja', { a: '{name}' });
      expect(checkCatalogs(directory).problems).toEqual([]);
      writeFileSync(join(directory, 'ja.json'), '{"a":"first","a":"{name}"}');
      expect(checkCatalogs(directory).problems[0]).toContain('duplicate catalog key');
      writeFileSync(join(directory, 'ja.json'), '{"a":"first","\\u0061":"{name}"}');
      expect(checkCatalogs(directory).problems[0]).toContain('duplicate catalog key');
      save('ja', { a: "{name} says \"a\": '{' '}'" });
      expect(checkCatalogs(directory).problems).toEqual([]);
      save('ja', JSON.parse('{"__proto__":"Unknown"}'));
      expect(checkCatalogs(directory).problems).toHaveLength(1);
      save('ja', { a: '設定', z: 'Unknown' });
      expect(checkCatalogs(directory).problems).toHaveLength(2);
      save('ja', { a: '設定' });
      expect(checkCatalogs(directory).problems).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it('detects generated-only README edits without modifying the checkout', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oyasumi-readme-test-'));
  try {
    cpSync('docs/readmes', join(directory, 'docs/readmes'), { recursive: true });
    cpSync(
      'docs/translation_contributors.json',
      join(directory, 'docs/translation_contributors.json')
    );
    writeFileSync(join(directory, 'README.md'), 'docs/readmes/generated/README_EN.md');
    const run = () =>
      spawnSync(process.execPath, [resolve('scripts/check-readmes.mjs')], {
        cwd: directory,
        encoding: 'utf8',
      });
    expect(run().status).toBe(0);
    if (process.platform !== 'win32') {
      rmSync(join(directory, 'README.md'));
      symlinkSync('docs\\readmes\\generated\\README_EN.md', join(directory, 'README.md'));
      expect(run().status).toBe(1);
      rmSync(join(directory, 'README.md'));
      symlinkSync('docs/readmes/generated/README_EN.md', join(directory, 'README.md'));
      expect(run().status).toBe(0);
    }
    const file = join(directory, 'docs/readmes/generated/README_EN.md');
    writeFileSync(file, 'Direct edit');
    expect(run().status).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('Direct edit');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 20000);
