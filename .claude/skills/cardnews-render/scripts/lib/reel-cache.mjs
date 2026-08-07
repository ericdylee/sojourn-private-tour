import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Bump when a change makes the SAME input produce a DIFFERENT frame — motion
 * vocabulary, encoder settings, capture timing. Bumping invalidates every
 * cached scene.
 */
export const RENDERER_VERSION = 'reel-1';

/**
 * Everything that can change a rendered scene goes in the key.
 *
 * Hashing the scene HTML alone would be a lie: editing brand.css would leave
 * every cached scene looking current while being stale. A cache that lies is
 * worse than no cache, because the wrong frames ship silently.
 */
export async function sceneKey({ sceneHtml, cssPaths = [], fontDir, photoPath, durationMs, fps, internal }) {
  const h = createHash('sha256');
  h.update(RENDERER_VERSION);
  h.update('\0');
  h.update(sceneHtml);
  h.update('\0');
  h.update(JSON.stringify({ durationMs, fps, internal: Boolean(internal) }));

  for (const p of cssPaths) {
    h.update('\0css:');
    h.update(p);
    h.update(await readFile(p));
  }

  if (fontDir) {
    const names = (await readdir(fontDir)).sort();
    for (const n of names) {
      h.update('\0font:');
      h.update(n);
      h.update(await readFile(join(fontDir, n)));
    }
  }

  if (photoPath) {
    h.update('\0photo:');
    h.update(photoPath);
    h.update(await readFile(photoPath));
  }

  return h.digest('hex');
}
