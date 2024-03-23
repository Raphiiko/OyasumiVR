import { mkdirp } from 'mkdirp';
import copy from 'recursive-copy';
import { rimraf } from 'rimraf';

async function main() {
  const coreSourceDirectory = 'src-mdns-sidecar/bin/Release/net8.0/win-x64/publish';
  const coreTargetDirectory = 'src-core/resources/dotnet-sidecars';
  await rimraf(coreTargetDirectory);
  await mkdirp(coreTargetDirectory);
  await copy(coreSourceDirectory, coreTargetDirectory, { overwrite: true });
}

main().catch((e) => {
  throw e;
});
