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

function markup(text, pluralArgs) {
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
  const rendered = [];
  const pluralMarkup = [];
  const fixedVariables = (text) => variables(text).filter((arg) => !pluralArgs.has(arg));
  const content = (node) =>
    node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(content).join('');
  const visible = (node) =>
    node.nodeName === '#text'
      ? Boolean(node.value.trim())
      : node.tagName === 'img' || (node.childNodes ?? []).some(visible);
  function visit(node) {
    if (node.nodeName === '#text') rendered.push(...variables(node.value));
    for (const attr of node.attrs ?? []) rendered.push(...variables(attr.value));
    const children = (node.childNodes ?? []).flatMap(visit);
    if (node.tagName) {
      if (!voidTags.has(node.tagName) && !node.sourceCodeLocation?.endTag)
        errors.push(`unclosed ${node.tagName}`);
      const attributes = node.attrs
        .map(({ name, value }) => [
          name,
          ['title', 'alt', 'aria-label'].includes(name) ? fixedVariables(value) : value,
        ])
        .sort((a, b) => a[0].localeCompare(b[0]));
      const label = content(node);
      const structure = JSON.stringify([
        node.tagName,
        attributes,
        children.sort(),
        fixedVariables(label),
        node.tagName === 'a' ? visible(node) : null,
      ]);
      for (const [location, value] of [
        ['text', label],
        ...node.attrs.map((attr) => [`@${attr.name}`, attr.value]),
      ]) {
        for (const arg of variables(value).filter((arg) => pluralArgs.has(arg)))
          pluralMarkup.push(JSON.stringify([structure, location, arg]));
      }
      return [structure];
    }
    return children;
  }
  const elements = visit(fragment);
  if (errors.length) throw new Error(`invalid HTML: ${errors.join(', ')}`);
  return { structure: elements.sort().join('|'), rendered: sorted(rendered), pluralMarkup };
}

export function messageContract(message, locale = 'en') {
  if (/[\uE000\uE001]/.test(message)) throw new Error('reserved argument marker');
  new MessageFormat({ cn: 'zh', tw: 'zh', jp: 'ja' }[locale] ?? locale).compile(message);
  const tokens = parse(message, { strictPluralKeys: false });
  const argumentsUsed = new Set();
  const selections = [];
  const plurals = new Set();
  const pluralTypes = new Map();
  const domains = new Map();
  const choiceId = (token) => JSON.stringify([token.type, token.arg, token.pluralOffset ?? 0]);
  function inspect(tokens) {
    for (const token of tokens) {
      if (token.arg) argumentsUsed.add(token.arg);
      if (token.param) inspect(token.param);
      if (!token.cases) continue;
      const caseKeys = token.cases.map((c) => c.key);
      if (new Set(caseKeys).size !== caseKeys.length)
        throw new Error(`duplicate ICU case for ${token.arg}`);
      if (token.type !== 'select') {
        plurals.add(token.arg);
        pluralTypes.set(token.arg, sorted([...(pluralTypes.get(token.arg) ?? []), token.type]));
      }
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
        parts = token.param
          ? walk(token.param, scenario, plural).map(
              (param) => marker(token.arg) + variables(param).map(marker).join('')
            )
          : [marker(token.arg ?? plural)];
      }
      variants = variants.flatMap((a) => parts.map((b) => a + b));
      if (variants.length > 256) throw new Error('more than 256 message branches');
    }
    return variants;
  }
  return {
    arguments: [...argumentsUsed].sort(),
    selections,
    branches: scenarios.map((scenario) => walk(tokens, scenario)),
    plurals: [...plurals],
    pluralTypes,
  };
}

export function compareMessage(english, translated, locale) {
  const source = messageContract(english);
  const target = messageContract(translated, locale);
  const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  const problems = ['arguments', 'selections'].filter((part) =>
    differs(source[part], target[part])
  );
  for (const [arg, types] of source.pluralTypes) {
    if (target.pluralTypes.has(arg) && differs(types, target.pluralTypes.get(arg)))
      problems.push('selections');
  }
  if (problems.includes('selections')) return problems;
  const pluralArgs = new Set([...source.plurals, ...target.plurals]);
  function summarize(variants) {
    const parsed = variants.map((text) => markup(text, pluralArgs));
    const used = parsed.map((variant) => variant.rendered);
    return {
      rendered: sorted(used.flat()),
      required: used[0].filter(
        (arg) => !pluralArgs.has(arg) && used.every((args) => args.includes(arg))
      ),
      markup: sorted(parsed.map((variant) => variant.structure)),
      pluralMarkup: sorted(parsed.flatMap((variant) => variant.pluralMarkup)),
    };
  }
  for (let i = 0; i < source.branches.length; i++) {
    const a = summarize(source.branches[i]),
      b = summarize(target.branches[i]);
    if (differs(a.rendered, b.rendered) || differs(a.required, b.required))
      problems.push('arguments');
    if (differs(a.markup, b.markup) || differs(a.pluralMarkup, b.pluralMarkup))
      problems.push('markup');
  }
  return sorted(problems);
}

function readCatalog(file) {
  const text = readFileSync(file, 'utf8');
  const parsed = JSON.parse(text);
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[{}:]/g) ?? [];
  const objects = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '{') objects.push(new Set());
    else if (tokens[i] === '}') objects.pop();
    else if (tokens[i].startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(tokens[i]);
      const keys = objects.at(-1);
      if (keys.has(key)) throw new Error(`duplicate catalog key: ${key}; run npm run tl clean`);
      keys.add(key);
    }
  }
  return flattenCatalog(parsed);
}

export function checkCatalogs(directory) {
  const english = readCatalog(`${directory}/en.json`);
  const problems = [];
  let count = 0;
  for (const file of readdirSync(directory).filter((f) => f.endsWith('.json'))) {
    const locale = file.slice(0, -5);
    let catalog;
    try {
      catalog = readCatalog(`${directory}/${file}`);
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
