import fs from 'fs';

async function handleSet(args) {
  const key = args[1];
  const value = args[2];
  const enFile = getLangFilePath('en');
  let enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const enFileContentFlattened = flattenObj(enFileContent);
  enFileContentFlattened[key] = value;
  enFileContent = unflattenObj(enFileContentFlattened);
  fs.writeFileSync(enFile, JSON.stringify(enFileContent, null, 2));
  console.log('Set key ' + key + ' to value ' + value + ' in ' + enFile);
}

async function handleUnset(args) {
  const key = args[1];
  getLangFilePaths().forEach((langFile) => {
    let langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));
    const langFileContentFlattened = flattenObj(langFileContent);
    delete langFileContentFlattened[key];
    langFileContent = unflattenObj(langFileContentFlattened);
    fs.writeFileSync(langFile, JSON.stringify(langFileContent, null, 2));
    console.log('Unset key ' + key + ' in ' + langFile);
  });
}

async function handleClean() {
  const enFile = getLangFilePath('en');
  let enFileContent = JSON.parse(fs.readFileSync(enFile, 'utf8'));
  const enFileContentFlattened = flattenObj(enFileContent);
  getLangFilePaths()
    .filter((f) => f !== enFile)
    .forEach((langFile) => {
      let langFileContent = JSON.parse(fs.readFileSync(langFile, 'utf8'));
      const langFileContentFlattened = Object.fromEntries(
        Object.entries(flattenObj(langFileContent)).filter(
          (entry) =>
            Object.keys(enFileContentFlattened).includes(entry[0]) &&
            entry[1] !== '{PLACEHOLDER}' &&
            entry[1]?.trim() !== ''
        )
      );
      let keysCleaned =
        Object.keys(flattenObj(langFileContent)).length -
        Object.keys(langFileContentFlattened).length;
      langFileContent = unflattenObj(langFileContentFlattened);
      fs.writeFileSync(langFile, JSON.stringify(langFileContent, null, 2));
      console.log('Cleaned ' + keysCleaned + ' key(s) in ' + langFile);
    });
  // Clean en.json last
  fs.writeFileSync(enFile, JSON.stringify(unflattenObj(enFileContentFlattened), null, 2));
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
  const langFiles = fs.readdirSync('./src-ui/assets/i18n');
  return langFiles.map((langFile) => getLangFilePath(langFile));
};

async function main() {
  const args = process.argv.slice(2);
  switch (args[0]) {
    case 'set':
      await handleSet(args);
      break;
    case 'unset':
      await handleUnset(args);
      break;
    case 'reset':
      await handleUnset(args);
      await handleSet(args);
      break;
    case 'clean':
      await handleClean(args);
      break;
    default:
      console.error('Invalid argument at index 0: ' + args[0] + '.');
      process.exit(1);
  }
}

main();
