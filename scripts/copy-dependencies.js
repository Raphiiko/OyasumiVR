import fs from 'fs';

async function main() {
  fs.copyFileSync('CHANGELOG.md', 'src/assets/CHANGELOG.md');
}

main().catch((e) => {
  throw e;
});
