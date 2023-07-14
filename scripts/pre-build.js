import fs from 'fs';
import { mkdirp } from 'mkdirp';
import { blurhashToCss } from 'blurhash-to-css';
import sharp from 'sharp';
import { encode } from 'blurhash';
import Css from 'json-to-css';

//
// BUILD PRELOAD ASSETS JSON
//
function getFilePaths(folder, prefix) {
  return fs.readdirSync(folder).map((file) => `${prefix}/${file}`);
}

const imageUrls = [
  ...getFilePaths('./src-ui/assets/img', '/assets/img'),
  'https://avatars.githubusercontent.com/u/111654848', // Raphiiko Avatar
];

const preloadAssetsData = {
  imageUrls,
};

fs.writeFileSync('./src-ui/assets/preload-assets.json', JSON.stringify(preloadAssetsData));

//
// GENERATE BLURHASH CSS FOR SPLASH SCREEN IMAGE
//
const kebabize = (str) =>
  str.replace(/[A-Z]+(?![a-z])|[A-Z]/g, ($, ofs) => (ofs ? '-' : '') + $.toLowerCase());

const encodeImageToBlurhash = (path) =>
  new Promise((resolve, reject) => {
    sharp(path)
      .raw()
      .ensureAlpha()
      .resize(32, 32, { fit: 'inside' })
      .toBuffer((err, buffer, { width, height }) => {
        if (err) return reject(err);
        resolve(encode(new Uint8ClampedArray(buffer), width, height, 4, 4));
      });
  });

encodeImageToBlurhash('./src-ui/assets/splashscreen/splash.jpg').then((hash) => {
  const css = Css.of({
    '.splash-blurhash': Object.fromEntries(
      Object.entries(blurhashToCss(hash)).map(([k, v]) => [kebabize(k), v])
    ),
  });
  fs.writeFileSync(
    './src-ui/assets/splashscreen/splash-blurhash.css',
    '/* GENERATED FILE, DO NOT EDIT!*/\n' + css
  );
});

//
// COPY DEPENDENCIES
//
fs.copyFileSync('CHANGELOG.md', 'src-ui/assets/CHANGELOG.md');
fs.copyFileSync('src-core/icons/Square150x150Logo.png', 'src-ui/assets/img/icon_150x150.png');
