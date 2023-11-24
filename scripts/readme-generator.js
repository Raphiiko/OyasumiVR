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
      localized = localized.replaceAll(key, value).replaceAll('<MARKDOWN-BR>', '<br>');
    });
    Object.entries(tokens).forEach(([key, value]) => {
      localized = localized.replaceAll(`{{token.${key}}}`, value);
    });
    fs.writeFileSync(`./docs/readmes/generated/README_${lang.toUpperCase()}.md`, localized);
  }
}

function generateSteamStoreDescriptions(langData) {
  const descriptionTemplate = fs
    .readFileSync('./docs/readmes/src/steam_description_template.txt')
    .toString();
  const outputTemplate = JSON.parse(
    fs.readFileSync('./docs/readmes/src/steam_output_template.json').toString()
  );
  for (const { lang, tokens, texts } of langData) {
    let localizedDescription = descriptionTemplate;
    Object.entries(texts).forEach(([key, value]) => {
      let sanitizedValue = value;
      // Remove HTML links
      sanitizedValue = sanitizedValue.replace(/<a\b[^>]*>(.*?)<\/a>/gi, '$1');
      // Remove markdown links
      sanitizedValue = sanitizedValue.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
      // Replace html and markdown formatting
      sanitizedValue = sanitizedValue
        .replaceAll(/\*\*(.+)\*\*/g, '[b]$1[/b]')
        .replaceAll(/_(.+)_/g, '[i]$1[/i]')
        .replaceAll('<MARKDOWN-BR>', ' ')
        .replaceAll('<br>', '\n')
        .replaceAll('<ul>', '[list]')
        .replaceAll('</ul>', '[/list]')
        .replaceAll(/\s*<li>\s*/g, '\n[*]')
        .replaceAll('</li>', '')
        .replaceAll('<b>', '[b]')
        .replaceAll('</b>', '[/b]')
        .replaceAll('<i>', '[i]')
        .replaceAll('</i>', '[/i]')
        .replaceAll(/(\r\n|\r|\n){3,}/g, '\n\n')
        .replaceAll('\r', '');
      localizedDescription = localizedDescription.replaceAll(key, sanitizedValue);
    });
    Object.entries(tokens).forEach(([key, value]) => {
      localizedDescription = localizedDescription.replaceAll(`{{token.${key}}}`, value);
    });
    const output = JSON.parse(JSON.stringify(outputTemplate));
    output['app[content][about]'] = localizedDescription;
    output['language'] = tokens['steamLang'];
    output['app[content][sysreqs][windows][min][osversion]'] = tokens['steamMinOSVersion'];
    output['app[content][sysreqs][windows][min][processor]'] = tokens['steamMinProcessor'];
    output['app[content][sysreqs][windows][min][graphics]'] = tokens['steamMinGraphics'];
    output['app[content][sysreqs][windows][min][notes]'] = tokens['steamNotes'];
    output['app[content][short_description]'] = tokens['steamShortDescription'];
    output['app[content][legal]'] = '[h2]VRChat[/h2]\n' + texts['{{VRCHAT_BODY}}'];
    fs.writeFileSync(
      `./docs/readmes/generated/STEAM_STORE_${lang.toUpperCase()}.json`,
      JSON.stringify(output, null, 2)
    );
  }
}

const langData = loadLanguageData();
generateMarkdownReadmes(langData);
generateSteamStoreDescriptions(langData);
