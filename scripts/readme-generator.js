import * as fs from 'fs';
import * as path from 'path';
import _ from 'lodash';

function parseTokens(raw) {
  const json = JSON.parse(raw);
  Object.keys(json).forEach((key) => {
    if (!json[key]) delete json[key];
  });
  return json;
}

function parseTexts(raw) {
  const texts = {};
  let currentKey = null;
  for (let line of raw.split('\n')) {
    if (line.match(/^\s*\{\{[A-Z_]+\}\}\s*$/)) {
      if (currentKey) {
        texts[currentKey] = texts[currentKey].trim();
      }
      currentKey = line.trim();
      if (!texts[currentKey]) texts[currentKey] = '';
      continue;
    }
    if (!currentKey) continue;
    texts[currentKey] += line + '\n';
  }
  texts[currentKey] = texts[currentKey].trim() ?? undefined;
  Object.entries(_.cloneDeep(texts)).forEach(([key, value]) => {
    if (!value) delete texts[key];
  });
  return texts;
}

function ensureDefaultsInSource(langData) {
  const en = langData.find((l) => l.lang === 'en');
  const clonedLangData = _.cloneDeep(langData);
  // Add empty strings for nonexistent texts and tokens
  clonedLangData.forEach((lang) => {
    if (lang.lang === 'en') return;
    Object.entries(en.texts).forEach(([key, value]) => {
      if (!lang.texts[key]) {
        lang.texts[key] = '';
      }
    });
    Object.entries(en.tokens).forEach(([key, value]) => {
      if (!lang.tokens[key]) {
        lang.tokens[key] = '';
      }
    });
    // If tokens or texts were missing, overwrite the source files with placeholders
    if (
      !_.isEqual(
        langData.find((l) => l.lang === lang.lang),
        lang
      )
    ) {
      const langPath = path.join('./docs/readmes/src/', lang.lang);
      fs.writeFileSync(path.join(langPath, 'tokens.json'), JSON.stringify(lang.tokens, null, 2));
      fs.writeFileSync(
        path.join(langPath, 'texts.txt'),
        Object.entries(lang.texts)
          .map(([key, value]) => `${key}\n${value}`)
          .join('\n\n')
      );
    }
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

function loadLanguageData() {
  const languages = fs.readdirSync('./docs/readmes/src/').filter((p) => {
    return fs.statSync(path.join('./docs/readmes/src/', p)).isDirectory();
  });

  // Parse tokens and texts
  const langData = languages.map((lang) => {
    const langPath = path.join('./docs/readmes/src/', lang);
    return {
      lang,
      tokens: parseTokens(fs.readFileSync(path.join(langPath, 'tokens.json')).toString()),
      texts: parseTexts(fs.readFileSync(path.join(langPath, 'texts.txt')).toString()),
    };
  });

  return langData;
}

function getTranslationContributors(mode /*: 'markdown' | 'steam'*/) {
  const contributors = JSON.parse(
    fs.readFileSync('./docs/translation_contributors.json').toString()
  );
  let result = '';
  const languages = _.groupBy(contributors, 'langCode');
  switch (mode) {
    case 'markdown': {
      Object.values(languages).forEach((contributors) => {
        result += `\n- ${contributors[0].langNameNative}`;
        if (
          contributors[0].langNameEnglish &&
          contributors[0].langNameNative !== contributors[0].langNameEnglish
        )
          result += ` (${contributors[0].langNameEnglish})`;
        if (contributors.length > 1) {
          result += ': Community contributions by';
        } else if (contributors[0].name !== 'Raphiiko') {
          result += ': Community contribution by';
        } else {
          result += ': by';
        }
        contributors.forEach((contributor, index) => {
          const name = contributor.url
            ? `[${contributor.name}](${contributor.url})`
            : contributor.name;
          if (index === contributors.length - 1 && contributors.length > 1) {
            result += ` and ${name}`;
          } else if (index === contributors.length - 2 || contributors.length === 1) {
            result += ` ${name}`;
          } else {
            result += ` ${name},`;
          }
        });
        result += `.`;
      });
      break;
    }
    case 'steam': {
      result += '[list]';
      Object.values(languages).forEach((contributors) => {
        result += `\r\n[*]${contributors[0].langNameNative}`;
        if (
          contributors[0].langNameEnglish &&
          contributors[0].langNameNative !== contributors[0].langNameEnglish
        )
          result += ` (${contributors[0].langNameEnglish})`;
        if (contributors.length > 1) {
          result += ': Community contributions by';
        } else if (contributors[0].name !== 'Raphiiko') {
          result += ': Community contribution by';
        } else {
          result += ': by';
        }
        contributors.forEach((contributor, index) => {
          const name = contributor.name;
          if (index === contributors.length - 1 && contributors.length > 1) {
            result += ` and ${name}`;
          } else if (index === contributors.length - 2 || contributors.length === 1) {
            result += ` ${name}`;
          } else {
            result += ` ${name},`;
          }
        });
        result += '.';
      });
      result += '\r\n[/list]';
      break;
    }
  }
  return result.trim();
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
    localized = localized.replaceAll(
      '{{TRANSLATION_CONTRIBUTORS_LIST}}',
      getTranslationContributors('markdown')
    );
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
    localizedDescription = localizedDescription.replaceAll(
      '{{TRANSLATION_CONTRIBUTORS_LIST}}',
      getTranslationContributors('steam')
    );
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

let langData = loadLanguageData();
langData = ensureDefaultsInSource(langData);
generateMarkdownReadmes(langData);
generateSteamStoreDescriptions(langData);
