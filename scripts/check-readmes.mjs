import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const temporary = mkdtempSync(join(tmpdir(), 'oyasumivr-readmes-'));
try {
  mkdirSync(join(temporary, 'docs/readmes/generated'), { recursive: true });
  cpSync('docs/readmes/src', join(temporary, 'docs/readmes/src'), { recursive: true });
  cpSync(
    'docs/translation_contributors.json',
    join(temporary, 'docs/translation_contributors.json')
  );
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('readme-generator.js', import.meta.url))],
    {
      cwd: temporary,
      stdio: 'inherit',
    }
  );
  if (result.status !== 0) throw new Error('README generation failed');
  const expected = join(temporary, 'docs/readmes/generated');
  const actual = 'docs/readmes/generated';
  const files = new Set([
    ...readdirSync(expected),
    ...readdirSync(actual).filter((file) => file !== 'README.md'),
  ]);
  const different = [...files].filter(
    (file) =>
      !existsSync(join(expected, file)) ||
      !existsSync(join(actual, file)) ||
      !readFileSync(join(expected, file)).equals(readFileSync(join(actual, file)))
  );
  const readmeTarget = 'docs/readmes/generated/README_EN.md';
  const rootReadme = lstatSync('README.md').isSymbolicLink()
    ? readlinkSync('README.md').replaceAll('\\', '/')
    : readFileSync('README.md', 'utf8').trim();
  if (
    rootReadme !== readmeTarget &&
    !readFileSync('README.md').equals(readFileSync(join(expected, 'README_EN.md')))
  )
    different.push('README.md');
  if (different.length)
    throw new Error(
      `Generated files differ: ${different.join(', ')}. Run npm run generate:readmes.`
    );
  console.log('Generated READMEs and Steam descriptions match their sources.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
