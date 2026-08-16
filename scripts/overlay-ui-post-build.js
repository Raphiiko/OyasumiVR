import fs from 'fs';
import path from 'path';

// The sidecar loads each overlay from its own directory (/dashboard, /splash, ...) off a plain
// static file server, so every overlay needs an index.html of its own on disk.
const OVERLAYS = ['dashboard', 'notifications', 'splash', 'tooltip'];
const buildDir = 'src-overlay-ui/build';

const index = fs.readFileSync(path.join(buildDir, 'index.html'));
for (const overlay of OVERLAYS) {
  const dir = path.join(buildDir, overlay);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), index);
}
console.log(`Wrote index.html for ${OVERLAYS.length} overlays in ${buildDir}/`);
