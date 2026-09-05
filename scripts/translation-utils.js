import fs from 'fs';

function writeLocaleFile(path, content) {
  fs.writeFileSync(path, JSON.stringify(content, null, 2) + '\n');
}

function handleMove(args) {
  const keyPrev = args[1];
  let keyNew = args[2];
  if (!keyPrev || !keyNew) {
    console.error('Both a source key and a target key are required. Usage: npm run tl mv <from> <to>');
    process.exit(1);
  }
  getLangFilePaths().forEach((langFile) => {
    let langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));
    const langFileContentFlattened = flattenObj(langFileContent);
    if (keyPrev.endsWith('.')) {
      if (!keyNew.endsWith('.')) keyNew += '.';
      Object.entries(structuredClone(langFileContentFlattened)).forEach(([key, value]) => {
        if (key.startsWith(keyPrev)) {
          const newKey = keyNew + key.slice(keyPrev.length);
          langFileContentFlattened[newKey] = value;
          delete langFileContentFlattened[key];
          console.log('Moved key ' + key + ' to ' + newKey + ' in ' + langFile);
        }
      });
    } else {
      if (langFileContentFlattened[keyPrev]) {
        langFileContentFlattened[keyNew] = langFileContentFlattened[keyPrev];
        delete langFileContentFlattened[keyPrev];
        console.log('Moved key ' + keyPrev + ' to ' + keyNew + ' in ' + langFile);
      }
    }
    langFileContent = unflattenObj(langFileContentFlattened);
    writeLocaleFile(langFile, langFileContent);
  });
}

function handleSet(args) {
  const key = args[1];
  const value = args[2];
  if (!key || value === undefined) {
    console.error('Both a key and a value are required. Usage: npm run tl set <key> <value>');
    process.exit(1);
  }
  const enFile = getLangFilePath('en');
  let enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const enFileContentFlattened = flattenObj(enFileContent);
  enFileContentFlattened[key] = value;
  enFileContent = unflattenObj(enFileContentFlattened);
  writeLocaleFile(enFile, enFileContent);
  console.log('Set key ' + key + ' to value ' + value + ' in ' + enFile);
}

function handleUnset(args) {
  const key = args[1];
  if (!key) {
    console.error('A key is required. Usage: npm run tl unset <key>');
    process.exit(1);
  }
  getLangFilePaths().forEach((langFile) => {
    let langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));
    const langFileContentFlattened = flattenObj(langFileContent);
    delete langFileContentFlattened[key];
    langFileContent = unflattenObj(langFileContentFlattened);
    writeLocaleFile(langFile, langFileContent);
    console.log('Unset key ' + key + ' in ' + langFile);
  });
}

function handleClean() {
  const enFile = getLangFilePath('en');
  let enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const enFileContentFlattened = Object.fromEntries(
    Object.entries(flattenObj(enFileContent)).filter(([k]) => !k.includes('!'))
  );
  getLangFilePaths()
    .filter((f) => f !== enFile)
    .forEach((langFile) => {
      let langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));
      const langFileContentFlattened = Object.fromEntries(
        Object.entries(flattenObj(langFileContent)).filter(
          (entry) =>
            Object.keys(enFileContentFlattened).includes(entry[0]) &&
            entry[1] !== '{PLACEHOLDER}' &&
            entry[1]?.trim() !== '' &&
            !entry[0].includes('!')
        )
      );
      let keysCleaned =
        Object.keys(flattenObj(langFileContent)).length -
        Object.keys(langFileContentFlattened).length;
      langFileContent = unflattenObj(langFileContentFlattened);
      writeLocaleFile(langFile, langFileContent);
      console.log('Cleaned ' + keysCleaned + ' key(s) in ' + langFile);
    });
  // Clean en.json last
  writeLocaleFile(enFile, unflattenObj(enFileContentFlattened));
}

function printTranslationCoverage() {
  const paths = getLangFilePaths();
  const enFile = paths.find((f) => f.includes('en'));
  const enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const enFileContentFlattened = flattenObj(enFileContent);
  const keys = Object.keys(enFileContentFlattened);
  let coverage = paths.reduce((acc, path) => {
    const langFileContent = JSON.parse(fs.readFileSync(path, 'utf8'));
    const langFileContentFlattened = flattenObj(langFileContent);
    const keysTranslated = keys.filter((key) => !!langFileContentFlattened[key]);
    const lang = path.split('/').pop().split('.').shift();
    acc[lang] = {
      'Coverage (#)': keysTranslated.length + '/' + keys.length,
      'Coverage (%)': Math.round((keysTranslated.length / keys.length) * 100) + '%',
    };
    return acc;
  }, {});
  // Sort coverage object on completion
  coverage = Object.fromEntries(
    Object.entries(coverage).sort((a, b) => {
      return parseInt(b[1]['Coverage (%)']) - parseInt(a[1]['Coverage (%)']);
    })
  );
  console.log('Translation coverage:');
  console.table(coverage);
}

function printMissingKeys(args) {
  const lang = args[1];
  if (!lang) {
    console.error('Language code is required. Usage: npm run tl missing <lang>');
    process.exit(1);
  }

  const enFile = getLangFilePath('en');
  const langFile = getLangFilePath(lang);

  if (!fs.existsSync(langFile)) {
    console.error(`Language file for '${lang}' not found at ${langFile}`);
    process.exit(1);
  }

  const enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));

  const enFileContentFlattened = flattenObj(enFileContent);
  const langFileContentFlattened = flattenObj(langFileContent);

  const missingKeys = Object.keys(enFileContentFlattened).filter(
    (key) => !langFileContentFlattened[key]
  );

  if (missingKeys.length === 0) {
    console.log(`No missing keys found for language '${lang}'!`);
    return;
  }

  console.log(`Missing keys for language '${lang}' (${missingKeys.length} total):`);
  console.log('');

  missingKeys.forEach((key) => {
    console.log(`${key}: "${enFileContentFlattened[key]}"`);
  });
}

function unflattenObj(ob) {
  // Make sure to sort the keys before unflattening
  const keys = Object.keys(ob);
  keys.sort();
  ob = keys.reduce((acc, e) => {
    acc[e] = ob[e];
    return acc;
  }, {});
  // Unflatten
  const result = {};
  for (const i in ob) {
    const keys = i.split('.');
    keys.reduce((r, e, j) => {
      return (
        r[e] || (r[e] = isNaN(Number(keys[j + 1])) ? (keys.length - 1 === j ? ob[i] : {}) : [])
      );
    }, result);
  }
  return result;
}

function flattenObj(ob) {
  // Flatten the object
  const result = {};
  for (const i in ob) {
    if (typeof ob[i] === 'object' && !Array.isArray(ob[i])) {
      const temp = flattenObj(ob[i]);
      for (const j in temp) result[i + '.' + j] = temp[j];
    } else result[i] = ob[i];
  }
  // Sort the resulting flattened object
  const keys = Object.keys(result);
  keys.sort();
  return keys.reduce((acc, e) => {
    acc[e] = result[e];
    return acc;
  }, {});
}

const getLangFilePath = (lang) =>
  `./src-ui/assets/i18n/${lang.endsWith('.json') ? lang.split('.')[0] : lang}.json`;

const getLangFilePaths = () => {
  const langFiles = fs.readdirSync('./src-ui/assets/i18n').filter((f) => f.endsWith('.json'));
  return langFiles.map((langFile) => getLangFilePath(langFile));
};

function main() {
  const args = process.argv.slice(2);
  switch (args[0]) {
    case 'set':
      handleSet(args);
      break;
    case 'unset':
      handleUnset(args);
      break;
    case 'reset':
      handleUnset(args);
      handleSet(args);
      break;
    case 'clean':
      handleClean();
      break;
    case 'mv': {
      handleMove(args);
      break;
    }
    case 'coverage': {
      printTranslationCoverage();
      break;
    }
    case 'missing': {
      printMissingKeys(args);
      break;
    }
    default:
      console.error('Invalid argument at index 0: ' + args[0] + '.');
      process.exit(1);
  }
}

main();
