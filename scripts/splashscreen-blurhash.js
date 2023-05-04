import { blurhashToCss } from 'blurhash-to-css';
import fs from 'fs';
import sharp from 'sharp';
import { encode } from 'blurhash';
import Css from 'json-to-css';

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

encodeImageToBlurhash('./src/assets/splashscreen/splash.jpg').then((hash) => {
  const css = Css.of({
    '.splash-blurhash': Object.fromEntries(
      Object.entries(blurhashToCss(hash)).map(([k, v]) => [kebabize(k), v])
    ),
  });
  fs.writeFileSync(
    './src/assets/splashscreen/splash-blurhash.css',
    '/* GENERATED FILE, DO NOT EDIT!*/\n' + css
  );
});
