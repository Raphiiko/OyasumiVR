import fs from 'fs';

async function main() {
  fs.copyFileSync('CHANGELOG.md', 'src/assets/CHANGELOG.md');
  fs.copyFileSync('src-tauri/icons/Square150x150Logo.png', 'src/assets/img/icon_150x150.png');
}

main().catch((e) => {
  throw e;
});
