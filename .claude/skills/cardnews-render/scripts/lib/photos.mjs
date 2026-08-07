import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Photo provenance. Images are held to the same standard as facts: nothing goes
 * into a deliverable unless its origin is on record (ADR-010, ADR-013). Missing
 * manifest is fine only for sets that use no photos at all — the per-image
 * check in checkPhotos() catches the mismatch either way.
 */
export async function loadPhotoIndex(manifestArg) {
  const manifestPath = resolve(manifestArg ?? 'assets/photos/manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    /* absent — handled per image */
  }
  return {
    manifestPath,
    photoIndex: new Map((manifest?.photos ?? []).map((p) => [p.file, p])),
  };
}

// A tour brand promises real places; an invented one is a misrepresented
// deliverable, not a style choice (ADR-010).
export async function checkPhotos(el, { photoIndex, manifestPath, label }) {
  const issues = [];

  const photos = await el.evaluate((node) =>
    [...node.querySelectorAll('.photo img')].map((img) => ({
      key: img.dataset.photo ?? null,
      slot: img.dataset.slot ?? null,
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
    })),
  );

  const hasCredit = await el.evaluate((node) => node.querySelectorAll('.photo-credit').length > 0);

  for (const p of photos) {
    const where = p.key ?? p.src ?? '(no src)';
    if (!p.loaded) issues.push(`${label}: PHOTO — ${where} failed to load`);
    if (!p.key || !p.slot) {
      issues.push(`${label}: PHOTO — ${where} is missing data-photo/data-slot`);
      continue;
    }
    const entry = photoIndex.get(p.key);
    if (!entry) {
      issues.push(`${label}: PHOTO — "${p.key}" is not in ${manifestPath}`);
      continue;
    }
    if (entry.slot !== p.slot) {
      issues.push(`${label}: PHOTO — "${p.key}" is slot "${entry.slot}" in the manifest, used as "${p.slot}"`);
    }
    if (p.slot === 'place' && entry.ai_generated) {
      issues.push(`${label}: PHOTO — "${p.key}" is AI-generated and cannot fill a place slot (ADR-010)`);
    }
    // Stock and licensed images carry attribution obligations. Own photos and
    // AI concept art do not — their provenance lives in the manifest instead of
    // cluttering the card.
    const rights = entry.rights ?? '';
    if (/^(unsplash|licensed:)/.test(rights) && !hasCredit) {
      issues.push(`${label}: PHOTO — "${p.key}" is ${rights} and needs a .photo-credit`);
    }
  }

  return issues;
}
