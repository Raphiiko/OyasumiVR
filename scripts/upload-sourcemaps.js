import { readFileSync, readdirSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';

const hasCredentials = process.env.BUGSINK_AUTH_TOKEN && process.env.BUGSINK_PROJECT;
if (process.argv.includes('--check')) {
  if (!hasCredentials) throw new Error('BUGSINK_AUTH_TOKEN and BUGSINK_PROJECT are required');
  process.exit(0);
}

const build = readFileSync('src-ui/build.ts', 'utf8');
const output = 'dist/oyasumivr';
const removeSourcemaps = () => {
  for (const file of readdirSync(output, { recursive: true })) {
    if (file.endsWith('.map')) rmSync(path.join(output, file));
  }
};
if (build.includes("FLAVOUR: BuildFlavour = 'DEV'")) {
  removeSourcemaps();
  process.exit(0);
}

const cli = path.join('node_modules', '@sentry', 'cli', 'bin', 'sentry-cli');
const run = (args, env = process.env) =>
  execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit', env });

run(['sourcemaps', 'inject', output]);

if (hasCredentials) {
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

removeSourcemaps();
