import fs from 'fs';
import { mkdirp } from 'mkdirp';

//
// COPY FONTS
//
const fontFiles = [
  // Poppins
  ...fs
    .readdirSync('node_modules/@fontsource/poppins/files/')
    .filter((f) => f.startsWith('poppins-latin-') && f.endsWith('.woff2'))
    .map((f) => 'node_modules/@fontsource/poppins/files/' + f),
  // Noto Sans JP
  ...fs
    .readdirSync('node_modules/@fontsource/noto-sans-jp/files/')
    .filter((f) => f.startsWith('noto-sans-jp-japanese-') && f.endsWith('.woff2'))
    .map((f) => 'node_modules/@fontsource/noto-sans-jp/files/' + f),
  // Noto Sans KR
  ...fs
    .readdirSync('node_modules/@fontsource/noto-sans-kr/files/')
    .filter((f) => f.startsWith('noto-sans-kr-korean-') && f.endsWith('.woff2'))
    .map((f) => 'node_modules/@fontsource/noto-sans-kr/files/' + f),
  // Noto Sans SC
  ...fs
    .readdirSync('node_modules/@fontsource/noto-sans-sc/files/')
    .filter((f) => f.startsWith('noto-sans-sc-chinese-simplified-') && f.endsWith('.woff2'))
    .map((f) => 'node_modules/@fontsource/noto-sans-sc/files/' + f),
  // Noto Sans TC
  ...fs
    .readdirSync('node_modules/@fontsource/noto-sans-tc/files/')
    .filter((f) => f.startsWith('noto-sans-tc-chinese-traditional-') && f.endsWith('.woff2'))
    .map((f) => 'node_modules/@fontsource/noto-sans-tc/files/' + f),
];
console.log(`Copying fonts...`);
await mkdirp('src-core/resources/fonts');
fontFiles.forEach((f) => {
  fs.copyFileSync(f, 'src-core/resources/fonts/' + f.split('/').pop());
});
console.log(`Copied ${fontFiles.length} fonts!`);
