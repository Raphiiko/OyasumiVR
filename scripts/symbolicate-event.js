import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';

// Resolves the native stack of a Bugsink event against the symbol store that
// scripts/archive-symbols.js fills.
const STORE = process.env.OYASUMIVR_SYMBOL_STORE || 'X:\\Projects\\OyasumiVR\\symstore';
const CACHE = join(tmpdir(), 'oyasumivr-symcache');
const API = 'https://sentry.raphii.co/api/canonical/0';
const SYMBOLIZER_PATHS = ['llvm-symbolizer', 'C:\\Program Files\\LLVM\\bin\\llvm-symbolizer.exe'];

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

/** Loads an event from a JSON file, a Bugsink event URL, or a bare event ID. */
async function loadEvent(input) {
  if (existsSync(input)) {
    const json = JSON.parse(readFileSync(input, 'utf8'));
    return json.data ?? json;
  }
  const id = input.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/?$)/i
  )?.[0];
  if (!id) throw new Error(`Not a file, a Bugsink event URL, or an event ID: ${input}`);
  if (!process.env.BUGSINK_AUTH_TOKEN) throw new Error('BUGSINK_AUTH_TOKEN is required');
  const response = await fetch(`${API}/events/${id}/`, {
    headers: { Authorization: `Bearer ${process.env.BUGSINK_AUTH_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Bugsink returned ${response.status} for event ${id}`);
  return (await response.json()).data;
}

/** Copies the exe and PDB of an image from the store into one cache folder, where the symbolizer finds the PDB beside the exe. */
function cacheImage(image) {
  // the store keys match the keys archive-symbols.js writes
  const exeKey = image.code_id.slice(0, 8).toUpperCase() + image.code_id.slice(8).toLowerCase();
  const [guid, age] = [image.id.slice(0, 36).replaceAll('-', ''), image.id.slice(37) || '0'];
  const pdbKey = (guid + parseInt(age, 16).toString(16)).toUpperCase();
  const folder = join(CACHE, pdbKey);
  for (const [name, key] of [
    [image.name, exeKey],
    [image.debug_file, pdbKey],
  ]) {
    const target = join(folder, name);
    if (existsSync(target)) continue;
    const source = join(STORE, name, key, name);
    if (!existsSync(source)) {
      throw new Error(
        `${source} is missing. Connect the NAS drive, or the build predates the store.`
      );
    }
    mkdirSync(folder, { recursive: true });
    console.error(`Copying ${source} into the cache`);
    copyFileSync(source, `${target}.partial`);
    renameSync(`${target}.partial`, target);
  }
  return join(folder, image.name);
}

function symbolize(exe, offsets) {
  for (const symbolizer of SYMBOLIZER_PATHS) {
    try {
      const output = execFileSync(
        symbolizer,
        [`--obj=${exe}`, '--relative-address', '--output-style=JSON', ...offsets],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
      return JSON.parse(output);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('llvm-symbolizer not found. Install LLVM: winget install LLVM.LLVM');
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run symbolicate -- <Bugsink event URL | event ID | event.json>');
  process.exit(1);
}
const event = await loadEvent(input);
const image = event.debug_meta?.images?.find(
  (candidate) => candidate.debug_file && candidate.code_id
);
if (!image) {
  console.error('The event has no debug_meta image, so its addresses cannot be resolved.');
  process.exit(1);
}
const exe = cacheImage(image);
const base = BigInt(image.image_addr);
const end = base + BigInt(image.image_size);

for (const exception of event.exception?.values ?? []) {
  console.log(`${exception.type}: ${exception.value ?? ''}`);

  // frames arrive oldest first, and each holds a return address, so step back into the call
  const frames = (exception.stacktrace?.frames ?? []).toReversed();
  const offsets = frames.map((frame) => {
    const address = BigInt(frame.instruction_addr ?? 0) - 1n;
    return address >= base && address < end ? `0x${(address - base).toString(16)}` : null;
  });
  const resolved = symbolize(exe, offsets.filter(Boolean));

  // print the newest frame first, with inlined calls indented under their caller
  let next = 0;
  frames.forEach((frame, index) => {
    const prefix = `#${String(index).padStart(2)} ${frame.instruction_addr}`;
    if (!offsets[index]) {
      console.log(`${prefix}  ${frame.function ?? '<unknown>'} (outside ${image.name})`);
      return;
    }
    resolved[next++].Symbol.forEach((symbol, depth) => {
      const location = symbol.FileName ? `  ${symbol.FileName}:${symbol.Line}` : '';
      const name = symbol.FunctionName || '<unknown>';
      console.log(
        `${depth ? ' '.repeat(prefix.length) + '  inlined' : prefix}  ${name}${location}`
      );
    });
  });
}
