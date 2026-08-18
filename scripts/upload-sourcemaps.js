import { readFileSync, readdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const build = readFileSync('src-ui/build.ts', 'utf8');
if (build.includes("FLAVOUR: BuildFlavour = 'DEV'")) process.exit(0);

const output = 'dist/oyasumivr';
const cli = path.join('node_modules', '@sentry', 'cli', 'bin', 'sentry-cli');
const run = (args, env = process.env) =>
  execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', env });

run(['sourcemaps', 'inject', output]);

if (process.env.BUGSINK_AUTH_TOKEN && process.env.BUGSINK_PROJECT) {
  run(
    [
      '--url',
      'https://sentry.raphii.co',
      'sourcemaps',
      '--org',
      'bugsinkhasnoorgs',
      '--project',
      process.env.BUGSINK_PROJECT,
      'upload',
      output,
    ],
    { ...process.env, SENTRY_AUTH_TOKEN: process.env.BUGSINK_AUTH_TOKEN }
  );
}

for (const file of readdirSync(output, { recursive: true })) {
  if (file.endsWith('.map')) rmSync(path.join(output, file));
}
