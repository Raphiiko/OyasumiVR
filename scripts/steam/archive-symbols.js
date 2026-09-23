import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';

// Symbol server layout, so a debugger finds the exe and PDB behind a dump on its own.
// README.txt in the store describes the layout.
const STORE = 'X:\\Projects\\OyasumiVR\\symstore';
const SOURCE_DIR = join('dist', 'steam', 'Win64');
const EXECUTABLE_NAME = 'OyasumiVR.exe';
// written only after a complete run, and outside the depot folders so it never ships
const MANIFEST = join('dist', 'steam', 'archived-symbols.json');
const PDB_DIRS = [
  'src-core/target/release',
  'src-core/target/debug',
  'src-elevated-sidecar/target/release',
  'src-privileged-launcher/target/release',
  'src-memory-watch/target/release',
];

const hex = (value, width = 0) => value.toString(16).toUpperCase().padStart(width, '0');

function formatGuid(buffer, offset) {
  return (
    hex(buffer.readUInt32LE(offset), 8) +
    hex(buffer.readUInt16LE(offset + 4), 4) +
    hex(buffer.readUInt16LE(offset + 6), 4) +
    buffer
      .subarray(offset + 8, offset + 16)
      .toString('hex')
      .toUpperCase()
  );
}

/** Returns the image key and CodeView record of a PE file, or null when it has no record. */
function readImage(file) {
  const pe = readFileSync(file);
  if (pe.length < 0x40 || pe.readUInt16LE(0) !== 0x5a4d) return null;
  const header = pe.readUInt32LE(0x3c);
  if (pe.readUInt32LE(header) !== 0x4550) return null;

  // locate the debug directory
  const coff = header + 4;
  const sectionCount = pe.readUInt16LE(coff + 2);
  const optional = coff + 20;
  const pe32Plus = pe.readUInt16LE(optional) === 0x20b;
  if (pe.readUInt32LE(optional + (pe32Plus ? 108 : 92)) <= 6) return null;
  const debugEntry = optional + (pe32Plus ? 112 : 96) + 6 * 8;
  const debugRva = pe.readUInt32LE(debugEntry);
  const debugSize = pe.readUInt32LE(debugEntry + 4);
  const sections = optional + pe.readUInt16LE(coff + 16);
  let debugOffset = null;
  for (let i = 0; i < sectionCount; i++) {
    const section = sections + i * 40;
    const address = pe.readUInt32LE(section + 12);
    if (debugRva >= address && debugRva < address + pe.readUInt32LE(section + 16)) {
      debugOffset = debugRva - address + pe.readUInt32LE(section + 20);
    }
  }
  if (!debugRva || debugOffset === null) return null;

  // read the RSDS CodeView record
  for (let entry = debugOffset; entry < debugOffset + debugSize; entry += 28) {
    const record = pe.readUInt32LE(entry + 24);
    if (pe.readUInt32LE(entry + 12) !== 2 || pe.readUInt32LE(record) !== 0x53445352) continue;
    return {
      imageKey: hex(pe.readUInt32LE(coff + 4), 8) + pe.readUInt32LE(optional + 56).toString(16),
      guid: formatGuid(pe, record + 4),
      age: hex(pe.readUInt32LE(record + 20)),
      pdbName: basename(pe.toString('utf8', record + 24, pe.indexOf(0, record + 24))),
    };
  }
  return null;
}

/** Returns the GUID of a native or .NET portable PDB, or null for any other file. */
function readPdbIdentity(pdbPath) {
  const file = openSync(pdbPath, 'r');
  const read = (position, length) => {
    const buffer = Buffer.alloc(length);
    readSync(file, buffer, 0, length, position);
    return buffer;
  };
  try {
    const superBlock = read(0, 56);
    if (superBlock.toString('latin1', 0, 4) === 'BSJB') {
      // the #Pdb stream starts with the GUID that the image's CodeView record carries
      const metadata = read(0, 512);
      let header = 20 + metadata.readUInt32LE(12);
      for (let i = metadata.readUInt16LE(header - 2); i > 0; i--) {
        const nameEnd = metadata.indexOf(0, header + 8);
        if (metadata.toString('latin1', header + 8, nameEnd) === '#Pdb') {
          return { portable: true, guid: formatGuid(read(metadata.readUInt32LE(header), 16), 0) };
        }
        header += 8 + Math.ceil((nameEnd - header - 7) / 4) * 4;
      }
      return null;
    }
    if (!superBlock.toString('latin1', 0, 24).startsWith('Microsoft C/C++ MSF 7.00')) return null;
    const blockSize = superBlock.readUInt32LE(32);
    const directoryBlockCount = Math.ceil(superBlock.readUInt32LE(44) / blockSize);
    const blockMap = read(superBlock.readUInt32LE(52) * blockSize, directoryBlockCount * 4);
    const directory = Buffer.concat(
      Array.from({ length: directoryBlockCount }, (_, i) =>
        read(blockMap.readUInt32LE(i * 4) * blockSize, blockSize)
      )
    );
    // the directory lists every stream size, then every stream's blocks; stream 1 holds the GUID
    const streamCount = directory.readUInt32LE(0);
    const firstStreamSize = directory.readUInt32LE(4);
    const firstStreamBlocks =
      firstStreamSize === 0xffffffff ? 0 : Math.ceil(firstStreamSize / blockSize);
    const infoBlock = directory.readUInt32LE(4 + streamCount * 4 + firstStreamBlocks * 4);
    return { portable: false, guid: formatGuid(read(infoBlock * blockSize, 28), 12) };
  } finally {
    closeSync(file);
  }
}

function findPdb(binary, image) {
  for (const directory of [dirname(binary), ...PDB_DIRS]) {
    const pdbPath = join(directory, image.pdbName);
    if (!existsSync(pdbPath)) continue;
    const identity = readPdbIdentity(pdbPath);
    if (identity?.guid !== image.guid) continue;
    return { pdbPath, pdbKey: image.guid + (identity.portable ? 'FFFFFFFF' : image.age) };
  }
  return null;
}

/** Copies a file into the store and returns its path relative to the store. */
function store(source, name, key) {
  const entry = join(name, key, name);
  const target = join(STORE, entry);
  if (existsSync(target)) return entry;
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, `${target}.partial`);
  renameSync(`${target}.partial`, target);
  return entry;
}

if (!existsSync(STORE)) {
  console.error(`Symbol store not found at ${STORE}. Connect the NAS drive and rerun.`);
  process.exit(1);
}

if (process.argv.includes('--check')) {
  const executable = join(SOURCE_DIR, EXECUTABLE_NAME);
  const image = existsSync(executable) && readImage(executable);
  const entries = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
  if (
    !image ||
    !entries.includes(join(EXECUTABLE_NAME, image.imageKey, EXECUTABLE_NAME)) ||
    !entries.every((entry) => existsSync(join(STORE, entry)))
  ) {
    console.error(
      `The symbol store has no symbols for ${executable}. ` +
        'Run `node scripts/steam/archive-symbols.js` with the NAS drive connected, or rebuild.'
    );
    process.exit(1);
  }
  process.exit(0);
}

rmSync(MANIFEST, { force: true });
const archived = [];
const entries = [];
for (const file of readdirSync(SOURCE_DIR, { recursive: true })) {
  if (!/\.(exe|dll)$/i.test(file)) continue;
  const binary = join(SOURCE_DIR, file);
  const image = readImage(binary);
  const pdb = image && findPdb(binary, image);
  if (!pdb) continue;
  entries.push(store(binary, basename(binary), image.imageKey));
  entries.push(store(pdb.pdbPath, image.pdbName, pdb.pdbKey));
  archived.push(file);
}

if (!archived.includes(EXECUTABLE_NAME)) {
  console.error(
    `No matching PDB found for ${EXECUTABLE_NAME}, so no symbols were archived for it.`
  );
  process.exit(1);
}
writeFileSync(MANIFEST, JSON.stringify(entries, null, 2) + '\n');
console.log(`Archived symbols for ${archived.length} files in ${STORE}:`);
for (const file of archived) console.log(`  ${file}`);
