import fs from 'fs';

function getFilePaths(folder, prefix) {
  return fs.readdirSync(folder).map((file) => `${prefix}/${file}`);
}

const imageUrls = [
  ...getFilePaths('./src/assets/img', '/assets/img'),
  'https://avatars.githubusercontent.com/u/111654848', // Raphiiko Avatar
];

const preloadAssetsData = {
  imageUrls,
};

fs.writeFileSync('./src/assets/preload-assets.json', JSON.stringify(preloadAssetsData));
