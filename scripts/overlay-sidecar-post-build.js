import { mkdirp } from 'mkdirp';
import copy from 'recursive-copy';
import { rimraf } from 'rimraf';

async function main() {
  const coreSourceDirectory = 'src-overlay-sidecar/bin/Release/net8.0/win-x64/publish';
  const coreTargetDirectory = 'src-core/resources/dotnet-sidecars';
  await mkdirp(coreTargetDirectory);
  await copy(coreSourceDirectory, coreTargetDirectory, { overwrite: true });
  const webSourceDirectory = 'src-overlay-ui/build';
  const webTargetDirectory = 'src-core/resources/dotnet-sidecars/ui';
  await rimraf(webTargetDirectory);
  await mkdirp(webTargetDirectory);
  await copy(webSourceDirectory, webTargetDirectory, { overwrite: true });
}

main().catch((e) => {
  throw e;
});
