import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse } from '@messageformat/parser';
import MessageFormat from '@messageformat/core';
import { parseFragment } from 'parse5';
import { HtmlParser } from '@angular/compiler';

export function flattenCatalog(value, prefix = '', result = Object.create(null)) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${prefix || 'catalog'} must be an object`);
  const keys = Object.keys(value);
  if (prefix && !keys.length) throw new Error(`${prefix} is empty; run npm run tl clean`);
  for (const key of keys) {
    if (!key || key.includes('.') || key.includes('!'))
      throw new Error(`Invalid catalog key: ${key}`);
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value[key] === 'string') {
      if (!value[key].trim() || value[key] === '{PLACEHOLDER}')
        throw new Error(`${path} is empty or a placeholder; run npm run tl clean`);
      result[path] = value[key];
    } else {
      flattenCatalog(value[key], path, result);
    }
  }
  if (!prefix && Object.keys(result).join('\0') !== Object.keys(result).sort().join('\0'))
    throw new Error('catalog keys are not sorted; run npm run tl clean');
  return result;
}

function markup(text) {
  const errors = [];
  for (const error of new HtmlParser().parse(text, 'translation', {
    tokenizeExpansionForms: false,
    tokenizeBlocks: false,
    tokenizeLet: false,
  }).errors)
    errors.push(error.msg);
  const fragment = parseFragment(text, {
    sourceCodeLocationInfo: true,
    onParseError: (e) => errors.push(e.code),
  });
  const elements = [];
  const voidTags = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ]);
  function visit(node) {
    if (node.tagName) {
      if (!voidTags.has(node.tagName) && !node.sourceCodeLocation?.endTag)
        errors.push(`unclosed ${node.tagName}`);
      const attributes = node.attrs
        .map(
          ({ name, value }) =>
            `${name}=${['title', 'alt', 'aria-label'].includes(name) ? '<translated>' : value}`
        )
        .sort();
      elements.push(`${node.tagName}[${attributes.join(',')}]`);
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(fragment);
  if (errors.length) throw new Error(`invalid HTML: ${errors.join(', ')}`);
  return elements.sort().join('|');
}

export function messageContract(message, locale = 'en') {
  new MessageFormat({ cn: 'zh', tw: 'zh', jp: 'ja' }[locale] ?? locale).compile(message);
  const argumentsUsed = new Set();
  const selections = [];
  function walk(tokens) {
    let variants = [''];
    for (const token of tokens) {
      if (token.arg) argumentsUsed.add(token.arg);
      let parts;
      if (token.cases) {
        const exact = token.cases
          .filter((c) => c.key.startsWith('='))
          .map((c) => c.key)
          .sort();
        if (exact.length || token.pluralOffset)
          selections.push(`${token.arg}:offset=${token.pluralOffset ?? 0}:${exact.join(',')}`);
        if (token.type === 'select')
          selections.push(
            `${token.arg}:${token.cases
              .map((c) => c.key)
              .sort()
              .join(',')}`
          );
        parts = token.cases.flatMap((c) => walk(c.tokens));
      } else if (token.type === 'content') {
        parts = [token.value];
      } else {
        parts = [token.arg ? `{${token.arg}}` : '#'];
      }
      variants = variants.flatMap((a) => parts.map((b) => a + b));
      if (variants.length > 256) throw new Error('more than 256 message branches');
    }
    return variants;
  }
  const variants = walk(parse(message, { strictPluralKeys: false }));
  return {
    arguments: [...argumentsUsed].sort(),
    selections: [...new Set(selections)].sort(),
    markup: [...new Set(variants.map(markup))].sort(),
  };
}

export function compareMessage(english, translated, locale) {
  const source = messageContract(english);
  const target = messageContract(translated, locale);
  return Object.keys(source).filter(
    (part) => JSON.stringify(source[part]) !== JSON.stringify(target[part])
  );
}

export function checkCatalogs(directory, exceptions = []) {
  const english = flattenCatalog(JSON.parse(readFileSync(`${directory}/en.json`, 'utf8')));
  const problems = [];
  let baselineCount = 0;
  let count = 0;
  for (const file of readdirSync(directory).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    let catalog;
    try {
      catalog = flattenCatalog(JSON.parse(readFileSync(`${directory}/${file}`, 'utf8')));
    } catch (error) {
      problems.push(`${file}: ${error.message}`);
      continue;
    }
    for (const [key, value] of Object.entries(catalog)) {
      count++;
      if (!Object.hasOwn(english, key)) {
        problems.push(`${locale}/${key}: absent from English; run npm run tl clean`);
        continue;
      }
      let rules;
      try {
        rules = compareMessage(english[key], value, locale);
      } catch (error) {
        rules = ['syntax'];
      }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([english[key], value]))
        .digest('hex');
      for (const rule of rules) {
        const index = exceptions.findIndex(
          (e) =>
            e.locale === locale &&
            e.key === key &&
            e.rule === rule &&
            e.fingerprint === fingerprint &&
            e.reason
        );
        if (index < 0) problems.push(`${locale}/${key}: ${rule} differs or is invalid`);
        else baselineCount++;
      }
    }
  }
  return { count, problems, baselineCount };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const exceptions = JSON.parse(readFileSync('scripts/translation-exceptions.json', 'utf8'));
  const { count, problems, baselineCount } = checkCatalogs('src-ui/assets/i18n', exceptions);
  console.log(
    `Checked ${count} translations; ${baselineCount} unchanged baseline issues. Missing translations use English fallback.`
  );
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}
