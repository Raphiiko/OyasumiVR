import * as fs from 'fs';
import * as path from 'path';

function parseTexts(raw) {
  const texts = {};
  let currentKey = null;
  for (let line of raw.split('\n')) {
    if (line.match(/^\s*\{\{[A-Z_]+\}\}\s*$/)) {
      if (currentKey) {
        texts[currentKey] = texts[currentKey].trim();
      }
      currentKey = line.trim();
      texts[currentKey] ??= '';
      continue;
    }
    if (!currentKey) continue;
    texts[currentKey] += line + '\n';
  }
  texts[currentKey] = texts[currentKey].trim();
  return texts;
}

function loadLanguageData() {
  const languages = fs.readdirSync('./docs/readmes/src/').filter((p) => {
    return fs.statSync(path.join('./docs/readmes/src/', p)).isDirectory();
  });

  // Parse tokens and texts
  const langData = languages.map((lang) => {
    const langPath = path.join('./docs/readmes/src/', lang);
    return {
      lang,
      tokens: JSON.parse(fs.readFileSync(path.join(langPath, 'tokens.json')).toString()),
      texts: parseTexts(fs.readFileSync(path.join(langPath, 'texts.txt')).toString()),
    };
  });

  // Add EN defaults
  langData.forEach((lang) => {
    if (lang.lang === 'en') return;
    const en = langData.find((l) => l.lang === 'en');
    lang.tokens = { ...en.tokens, ...lang.tokens };
    lang.texts = { ...en.texts, ...lang.texts };
  });

  return langData;
}

function generateMarkdownReadmes(langData) {
  const template = fs.readFileSync('./docs/readmes/src/readme_template.md').toString();
  for (const { lang, tokens, texts } of langData) {
    let localized = template;
    Object.entries(texts).forEach(([key, value]) => {
      localized = localized.replaceAll(key, value);
    });
    Object.entries(tokens).forEach(([key, value]) => {
      localized = localized.replaceAll(`{{token.${key}}}`, value);
    });
    fs.writeFileSync(`./docs/readmes/generated/README_${lang.toUpperCase()}.md`, localized);
  }
}

const langData = loadLanguageData();
generateMarkdownReadmes(langData);
