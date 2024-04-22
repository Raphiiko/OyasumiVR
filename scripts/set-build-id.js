import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const revision = execSync('git rev-parse --short HEAD').toString().trim();

{
  let uiFlavour = readFileSync('src-ui/build.ts').toString();
  uiFlavour = uiFlavour.replaceAll(
    /export const BUILD_ID = '([a-zA-Z0-9]|\s)*';/g,
    `export const BUILD_ID = '${revision}';`
  );
  writeFileSync('src-ui/build.ts', uiFlavour);
  console.log('Updated src-ui/build.ts');
}

{
  let splashScreenHtml = readFileSync('src-ui/assets/splashscreen/splashscreen.html').toString();
  splashScreenHtml = splashScreenHtml.replaceAll(
    /\s+const buildId = ['"][a-fA-F0-9]+['"];\s+/g,
    `\nconst buildId = '${revision}';\n`
  );
  writeFileSync('src-ui/assets/splashscreen/splashscreen.html', splashScreenHtml);
  console.log('Updated src-ui/assets/splashscreen/splashscreen.html');
}
