import {mkdirp} from 'mkdirp';
import copy from 'recursive-copy';
import { rimraf } from 'rimraf'

async function main() {
  const source = "src-elevated-sidecar/target/release/"
  const targetDirectory = "src-core/resources/elevated-sidecar/"
  await rimraf(targetDirectory);
  await mkdirp(targetDirectory);
  await copy(source, targetDirectory, {
    overwrite: true,
    filter: ['oyasumivr-elevated-sidecar.exe']
  });
}

main().catch((e) => {
  throw e;
});
