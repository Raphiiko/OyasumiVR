import { existsSync, readFileSync } from 'fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/**
 * The flavour src-core is currently set to, as written by scripts/set-flavour.js.
 * Throws rather than guessing, because a wrong answer decides whether a build may ship unsigned.
 */
export function readBuildFlavour() {
  const path = 'src-core/src/flavour.rs';
  const match = readFileSync(path)
    .toString()
    .match(/pub const BUILD_FLAVOUR: BuildFlavour = BuildFlavour::(Dev|Standalone|Steam);/);
  if (!match) {
    throw new Error(`Could not read the build flavour from ${path}. Run: npm run set-flavour DEV`);
  }
  return match[1];
}

/**
 * A build of any flavour but Dev ships the elevated sidecar, and the privileged launcher refuses to
 * start it without a signature.
 */
export function requireSigningKeyForShippableBuild() {
  if (readBuildFlavour() === 'Dev') return;
  if (process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()) return;
  throw new Error(
    'TAURI_SIGNING_PRIVATE_KEY is required to build a Steam or standalone flavour, because the ' +
      'elevated sidecar must be signed. Set it in the environment or in .env.local, together with ' +
      'TAURI_SIGNING_PRIVATE_KEY_PASSWORD.'
  );
}
