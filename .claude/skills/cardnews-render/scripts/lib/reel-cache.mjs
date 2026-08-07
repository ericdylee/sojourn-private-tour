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
 * Writes one variable-length field into the hash behind an explicit 4-byte
 * big-endian byte-length prefix.
 *
 * A `\0`-and-marker separator scheme is not enough: content is hashed
 * verbatim, so a payload that happens to *contain* the separator bytes can
 * make two structurally different inputs (e.g. two css entries vs. one
 * entry whose content embeds the next entry's marker+path+bytes) collapse
 * to the identical byte stream, and therefore the identical hash. A length
 * prefix makes every field self-delimiting — the bytes inside a field can
 * never be reinterpreted as a boundary, no matter what they contain.
 */
function writeField(h, value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  h.update(len);
  h.update(buf);
}

/**
 * Digests a file's bytes on their own before folding the result into the
 * outer hash. A sha256 digest is always exactly 32 bytes, so — unlike the
 * raw file content it stands in for — it can never be mistaken for a run of
 * markers or another field's boundary, regardless of what the file contains.
 */
async function digestFile(path) {
  const bytes = await readFile(path);
  return createHash('sha256').update(bytes).digest();
}

/**
 * Everything that can change a rendered scene goes in the key.
 *
 * Hashing the scene HTML alone would be a lie: editing brand.css would leave
 * every cached scene looking current while being stale. A cache that lies is
 * worse than no cache, because the wrong frames ship silently.
 */
export async function sceneKey({ sceneHtml, headHtml = '', cssPaths = [], fontDir, photoPath, durationMs, fps, internal }) {
  const h = createHash('sha256');
  writeField(h, RENDERER_VERSION);
  writeField(h, sceneHtml);
  /* The document <head> is shared by every scene, so it is the one input a
   * per-scene hash is most likely to forget — and forgetting it is the failure
   * this module exists to prevent. A <style> block or a <link> added to the
   * head restyles all five scenes while every scene's own outerHTML is
   * byte-identical, so without this field the whole reel reports cache hits and
   * ships the frames rendered before the edit. Shared input, shared
   * invalidation: changing the head invalidates every scene, which is exactly
   * what the change did to the pixels. */
  writeField(h, 'head:');
  writeField(h, headHtml ?? '');
  writeField(h, JSON.stringify({ durationMs, fps, internal: Boolean(internal) }));

  // cssPaths is hashed in the order given — not sorted. Order is
  // load-bearing for cache reuse (reordering the caller's array produces a
  // different key, i.e. a cache miss) but never for correctness (it can
  // never produce a false hit). Do not add a sort here.
  for (const p of cssPaths) {
    writeField(h, 'css:');
    writeField(h, p);
    h.update(await digestFile(p));
  }

  if (fontDir) {
    const names = (await readdir(fontDir)).sort();
    for (const n of names) {
      writeField(h, 'font:');
      writeField(h, n);
      h.update(await digestFile(join(fontDir, n)));
    }
  }

  if (photoPath) {
    writeField(h, 'photo:');
    writeField(h, photoPath);
    h.update(await digestFile(photoPath));
  }

  return h.digest('hex');
}
