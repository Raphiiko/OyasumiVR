import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const sorted = (values) => [...new Set(values)].sort();
const marker = (name) => `\uE000${name}\uE001`;
const variables = (text) =>
  sorted([...text.matchAll(/\uE000([^\uE001]+)\uE001/g)].map((m) => m[1]));

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
    const children = (node.childNodes ?? []).flatMap(visit);
    if (node.tagName) {
      if (!voidTags.has(node.tagName) && !node.sourceCodeLocation?.endTag)
        errors.push(`unclosed ${node.tagName}`);
      const attributes = node.attrs
        .map(({ name, value }) => [
          name,
          ['title', 'alt', 'aria-label'].includes(name) ? variables(value) : value,
        ])
        .sort((a, b) => a[0].localeCompare(b[0]));
      const content = (n) =>
        n.nodeName === '#text' ? n.value : (n.childNodes ?? []).map(content).join('');
      const label = content(node);
      return [
        JSON.stringify([
          node.tagName,
          attributes,
          children.sort(),
          variables(label),
          node.tagName === 'a' ? Boolean(label.trim() || children.length) : null,
        ]),
      ];
    }
    return children;
  }
  const elements = visit(fragment);
  if (errors.length) throw new Error(`invalid HTML: ${errors.join(', ')}`);
  return elements.sort().join('|');
}

export function messageContract(message, locale = 'en') {
  if (/[\uE000\uE001]/.test(message)) throw new Error('reserved argument marker');
  new MessageFormat({ cn: 'zh', tw: 'zh', jp: 'ja' }[locale] ?? locale).compile(message);
  const tokens = parse(message, { strictPluralKeys: false });
  const argumentsUsed = new Set();
  const selections = [];
  const plurals = new Set();
  const domains = new Map();
  const choiceId = (token) => JSON.stringify([token.type, token.arg, token.pluralOffset ?? 0]);
  function inspect(tokens) {
    for (const token of tokens) {
      if (token.arg) argumentsUsed.add(token.arg);
      if (!token.cases) continue;
      if (token.type !== 'select') plurals.add(token.arg);
      const keys = token.cases
        .filter((c) => token.type === 'select' || c.key.startsWith('='))
        .map((c) => c.key);
      if (keys.length || token.pluralOffset) {
        const id = choiceId(token);
        domains.set(id, sorted([...(domains.get(id) ?? []), ...keys, 'other']));
      }
      for (const branch of token.cases) inspect(branch.tokens);
    }
  }
  inspect(tokens);
  let scenarios = [{}];
  for (const [id, keys] of [...domains].sort()) {
    selections.push(JSON.stringify([id, keys]));
    scenarios = scenarios.flatMap((scenario) => keys.map((key) => ({ ...scenario, [id]: key })));
    if (scenarios.length > 256) throw new Error('more than 256 semantic choices');
  }
  function walk(tokens, scenario, plural) {
    let variants = [''];
    for (const token of tokens) {
      let parts;
      if (token.cases) {
        const key = scenario[choiceId(token)];
        const exact = token.cases.find((c) => c.key === key);
        const branches =
          token.type === 'select'
            ? [exact ?? token.cases.find((c) => c.key === 'other')]
            : key?.startsWith('=') && exact
              ? [exact]
              : token.cases.filter((c) => !c.key.startsWith('='));
        parts = branches.flatMap((c) =>
          walk(c.tokens, scenario, token.type === 'select' ? plural : token.arg)
        );
      } else if (token.type === 'content') {
        parts = [token.value];
      } else {
        parts = [marker(token.arg ?? plural)];
      }
      variants = variants.flatMap((a) => parts.map((b) => a + b));
      if (variants.length > 256) throw new Error('more than 256 message branches');
    }
    return variants;
  }
  const branches = scenarios.map((scenario) => {
    const variants = walk(tokens, scenario);
    const used = variants.map(variables);
    return {
      rendered: sorted(used.flat()),
      required: used[0].filter(
        (arg) => !plurals.has(arg) && used.every((args) => args.includes(arg))
      ),
      markup: sorted(variants.map(markup)),
    };
  });
  return {
    arguments: [...argumentsUsed].sort(),
    selections,
    branches,
    plurals: [...plurals],
  };
}

export function compareMessage(english, translated, locale) {
  const source = messageContract(english);
  const target = messageContract(translated, locale);
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const problems = ['arguments', 'selections'].filter((part) =>
    differs(source[part], target[part])
  );
  if (problems.includes('selections')) return problems;
  const pluralArgs = new Set([...source.plurals, ...target.plurals]);
  for (let i = 0; i < source.branches.length; i++) {
    const a = source.branches[i],
      b = target.branches[i];
    if (
      differs(a.rendered, b.rendered) ||
      differs(
        a.required.filter((arg) => !pluralArgs.has(arg)),
        b.required.filter((arg) => !pluralArgs.has(arg))
      )
    )
      problems.push('arguments');
    if (differs(a.markup, b.markup)) problems.push('markup');
  }
  return sorted(problems);
}

export function checkCatalogs(directory) {
  const english = flattenCatalog(JSON.parse(readFileSync(`${directory}/en.json`, 'utf8')));
  const problems = [];
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
        problems.push(`${locale}/${key}: ${error.message}`);
        continue;
      }
      for (const rule of rules) problems.push(`${locale}/${key}: ${rule} differs or is invalid`);
    }
  }
  return { count, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { count, problems } = checkCatalogs('src-ui/assets/i18n');
  console.log(`Checked ${count} translations. Missing translations use English fallback.`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}
