// Checks that every ICU string in the translation files still compiles under Transloco's
// messageformat transpiler. Run with: node scripts/check-icu.mjs
import '@angular/compiler';
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert';
import { Injector } from '@angular/core';
import { MessageFormatTranspiler } from '@jsverse/transloco-messageformat';

const injector = Injector.create({
  providers: [{ provide: MessageFormatTranspiler, deps: [] }],
});
const transpiler = injector.get(MessageFormatTranspiler);

const dir = 'src-ui/assets/i18n';
let checked = 0;
const failures = [];

function walk(node, lang, path) {
  for (const [key, value] of Object.entries(node)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (typeof value === 'object' && value !== null) {
      walk(value, lang, keyPath);
    } else if (typeof value === 'string' && /\{[^}]*,\s*(plural|select|selectordinal)/.test(value)) {
      checked++;
      try {
        const result = transpiler.transpile({
          value,
          params: { count: 2, playerCount: 2, threshold: 2, triggerCount: 2, hours: 2, minutes: 2 },
          translation: {},
          key: keyPath,
        });
        assert(typeof result === 'string' && result.length > 0, 'empty result');
        assert(!result.includes('plural'), `plural not expanded: ${result}`);
      } catch (e) {
        failures.push(`${lang}/${keyPath}: ${e.message}`);
      }
    }
  }
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const lang = file.replace('.json', '');
  // Transloco hands the raw language code to the transpiler on every language change.
  transpiler.setLocale(lang);
  walk(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')), lang, '');
}
transpiler.setLocale('en');

console.log(`checked ${checked} ICU messages`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

// Apostrophe escaping: '' is a literal apostrophe, not a messageformat quote.
const apostrophe = transpiler.transpile({
  value: "delete ''{name}''?",
  params: { name: 'Bob' },
  translation: {},
  key: 'test',
});
assert.strictEqual(apostrophe, "delete 'Bob'?", `got: ${apostrophe}`);
console.log('apostrophe escaping ok');
