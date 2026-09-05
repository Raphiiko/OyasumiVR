import { cp, mkdir, rm } from 'node:fs/promises';

async function main() {
  const coreSourceDirectory = 'src-overlay-sidecar/bin/Release/net10.0-windows/win-x64/publish';
  const coreTargetDirectory = 'src-core/resources/dotnet-sidecars';
  await mkdir(coreTargetDirectory, { recursive: true });
  await cp(coreSourceDirectory, coreTargetDirectory, { recursive: true, force: true });
  const webSourceDirectory = 'src-overlay-ui/build';
  const webTargetDirectory = 'src-core/resources/dotnet-sidecars/ui';
  await rm(webTargetDirectory, { recursive: true, force: true });
  await mkdir(webTargetDirectory, { recursive: true });
  await cp(webSourceDirectory, webTargetDirectory, { recursive: true, force: true });
}

main().catch((e) => {
  throw e;
});
