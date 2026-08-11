import fs from 'fs';
import { blurhashToCss } from 'blurhash-to-css';
import sharp from 'sharp';
import { encode } from 'blurhash';
import Css from 'json-to-css';
import { parseFile } from 'music-metadata';

//
// COPY FONTS
//
// Synced to src-core/resources/fonts/ (the source of truth Tauri bundles for
// release builds) and to src-core/target/{debug,release}/resources/fonts/ when
// those exist. The latter is needed because the core's HTTP server reads fonts
// from a cwd-relative path, and main.rs sets cwd to the executable directory â€”
// Tauri's resource copy populates target/<profile>/resources/ during an initial
// build but doesn't pick up newly-added subdirectories on incremental rebuilds,
// so we mirror them here.
//
{
  const fontSources = [
    { dir: 'node_modules/@fontsource/poppins/files/', prefix: 'poppins-latin-' },
    { dir: 'node_modules/@fontsource/noto-sans-jp/files/', prefix: 'noto-sans-jp-japanese-' },
    { dir: 'node_modules/@fontsource/noto-sans-kr/files/', prefix: 'noto-sans-kr-korean-' },
    {
      dir: 'node_modules/@fontsource/noto-sans-sc/files/',
      prefix: 'noto-sans-sc-chinese-simplified-',
    },
    {
      dir: 'node_modules/@fontsource/noto-sans-tc/files/',
      prefix: 'noto-sans-tc-chinese-traditional-',
    },
  ];
  const fontFiles = fontSources.flatMap(({ dir, prefix }) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.woff2'))
      .map((f) => dir + f)
  );
  const fontTargets = [
    { destDir: 'src-core/resources/fonts', requiredParent: 'src-core/resources' },
    {
      destDir: 'src-core/target/debug/resources/fonts',
      requiredParent: 'src-core/target/debug',
    },
    {
      destDir: 'src-core/target/release/resources/fonts',
      requiredParent: 'src-core/target/release',
    },
  ];
  for (const { destDir, requiredParent } of fontTargets) {
    if (!fs.existsSync(requiredParent)) continue;
    fs.mkdirSync(destDir, { recursive: true });
    fontFiles.forEach((f) => {
      fs.copyFileSync(f, destDir + '/' + f.split('/').pop());
    });
    console.log(`Copied ${fontFiles.length} fonts to ${destDir}/`);
  }
}

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

//
// Generate notification sound types
//
async function getDurationInSeconds(path) {
  const metadata = await parseFile(path, { duration: true });
  console.log('Getting duration for', path, metadata.format.duration);
  return metadata.format.duration;
}

(async () => {
  const sounds = fs
    .readdirSync('src-core/resources/sounds')
    .filter((f) => f.endsWith('.ogg'))
    .map((f) => f.substring(0, f.length - 4));
  // Get the duration for each of these sounds
  const NotificationSoundDurations = (
    await Promise.all(
      sounds.map(async (s) => {
        const path = `src-core/resources/sounds/${s}.ogg`;
        const duration = await getDurationInSeconds(path);
        return {
          ref: s,
          duration,
        };
      })
    )
  ).reduce((acc, curr) => {
    acc[curr.ref] = curr.duration.toFixed(1);
    return acc;
  }, {});
  // TS (UI)
  let typeFile = 'src-ui/app/models/notification-sounds.generated.ts';
  let typeContent = `/* THIS FILE IS GENERATED. DO NOT EDIT IT MANUALLY. */\nexport type NotificationSoundRef =\n${sounds
    .map((s) => `  | '${s}'`)
    .join('\n')};\n\n`;
  typeContent += `export const NotificationSoundDurations: Record<NotificationSoundRef, number> = {\n${sounds
    .map((s, i) => `  ${s}: ${NotificationSoundDurations[s]},`)
    .join('\n')}\n};\n`;
  fs.writeFileSync(typeFile, typeContent);
  // Rust (Core)
  typeFile = 'src-core/src/os/sounds_gen.rs';
  typeContent = `/* THIS FILE IS GENERATED. DO NOT EDIT IT MANUALLY. */\npub static SOUND_FILES: &[&str] = &[\n${sounds
    .map((s) => `    "${s}",`)
    .join('\n')}\n];\n`;
  fs.writeFileSync(typeFile, typeContent);
})();
