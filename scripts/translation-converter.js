import fs from 'fs';
import ExcelJS from 'exceljs';

async function jsonToXLS(fileName) {
  if (!fileName.endsWith('.json')) fileName += '.json';
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Translations');
  const headerRow = worksheet.addRow([
    'Translation Key',
    'en'.toUpperCase(),
    fileName.slice(0, fileName.length - 5).toUpperCase(),
  ]);
  headerRow.font = { bold: true };

  const langMap = flattenObj(
    JSON.parse(fs.readFileSync('./src/assets/i18n/' + fileName).toString())
  );
  const enMap = flattenObj(JSON.parse(fs.readFileSync('./src/assets/i18n/en.json').toString()));
  Object.entries(enMap).forEach(([key, value]) => {
    worksheet.addRow([key, value, langMap[key] || '{PLACEHOLDER}']);
  });
  const outputFile = './' + fileName.slice(0, fileName.length - 5) + '.xlsx';
  await workbook.xlsx.writeFile(outputFile);
  console.log('XLSX file written to ' + outputFile);
}

async function xlsToJson(fileName) {
  if (!fileName.endsWith('.xlsx')) fileName += '.xlsx';
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fileName);
  const worksheet = workbook.getWorksheet('Translations');
  const langMap = {};
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = row.getCell(1).value;
    const value = row.getCell(3).value;
    if (key && value) langMap[key] = value;
  });
  const outputFile = './src/assets/i18n/' + fileName.slice(0, fileName.length - 5) + '.json';
  fs.writeFileSync(outputFile, JSON.stringify(unflattenObj(langMap), null, 2));
  console.log('JSON file written to ' + outputFile);
}

const unflattenObj = (ob) => {
  const result = {};
  for (const i in ob) {
    const keys = i.split('.');
    keys.reduce((r, e, j) => {
      return r[e] || (r[e] = isNaN(Number(keys[j + 1])) ? (keys.length - 1 === j ? ob[i] : {}) : []);
    }, result);
  }
  return result;
};

const flattenObj = (ob) => {
  let result = {};
  for (const i in ob) {
    if (typeof ob[i] === 'object' && !Array.isArray(ob[i])) {
      const temp = flattenObj(ob[i]);
      for (const j in temp) result[i + '.' + j] = temp[j];
    } else result[i] = ob[i];
  }
  return result;
};

async function main() {
  const args = process.argv.slice(2);
  switch (args[0]) {
    case 'jsonToXLS':
      await jsonToXLS(args[1]);
      break;
    case 'xlsToJson':
      await xlsToJson(args[1]);
      break;
    default:
      console.error(
        'Invalid argument at index 0: ' + args[0] + '. Expected either jsonToXLS or xlsToJson.'
      );
      process.exit(1);
  }
}

main();
