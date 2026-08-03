#!/usr/bin/env node
/**
 * Sojourn card news renderer.
 *
 * Screenshots every `<section class="card">` in an HTML file at exactly 1080x1080
 * and writes them as output/cards/01.png ... NN.png.
 *
 * Usage:
 *   node render-cards.mjs <input.html> [outDir]
 *
 * Requires playwright chromium. Install once (inside this scripts/ dir, NOT the
 * project root — a root package.json would trip the repo's Stop hook):
 *   cd .claude/skills/cardnews-render/scripts && npm i && npx playwright install chromium
 */

import { chromium } from 'playwright';
import { mkdir, access, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CARD = 1080;

const [, , inputArg, outArg, manifestArg] = process.argv;

if (!inputArg) {
  console.error('usage: node render-cards.mjs <input.html> [outDir]');
  process.exit(2);
}

const inputPath = resolve(inputArg);
const outDir = resolve(outArg ?? 'output/cards');

try {
  await access(inputPath);
} catch {
  console.error(`input not found: ${inputPath}`);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

// Photo manifest. Images are held to the same standard as facts: nothing goes
// into a deliverable unless its origin is on record. Missing manifest is fine
// only for sets that use no photos at all — the per-image check below catches
// the mismatch either way.
const manifestPath = resolve(manifestArg ?? 'assets/photos/manifest.json');
let manifest = null;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  /* absent — handled per image */
}

const photoIndex = new Map((manifest?.photos ?? []).map((p) => [p.file, p]));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: CARD, height: CARD },
  deviceScaleFactor: 1,
});

const failures = [];

page.on('console', (m) => {
  if (m.type() === 'error') failures.push(`console: ${m.text()}`);
});
page.on('requestfailed', (r) => {
  failures.push(`request failed: ${r.url()} (${r.failure()?.errorText})`);
});

await page.goto(pathToFileURL(inputPath).href, { waitUntil: 'networkidle' });

// Webfonts decide the layout. Screenshotting before they land produces
// fallback-metric cards that silently differ from what the author saw.
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

// Guides are an authoring aid, never part of the deliverable.
await page.evaluate(() => {
  document.querySelectorAll('.guides').forEach((el) => el.classList.remove('guides'));
  document.body.style.background = 'transparent';
});

const cards = await page.$$('section.card');

if (cards.length === 0) {
  console.error('no <section class="card"> found — nothing to render');
  await browser.close();
  process.exit(1);
}

const report = [];

for (const [i, card] of cards.entries()) {
  const n = String(i + 1).padStart(2, '0');
  const box = await card.boundingBox();

  if (!box || Math.round(box.width) !== CARD || Math.round(box.height) !== CARD) {
    failures.push(
      `card ${n}: expected ${CARD}x${CARD}, got ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`,
    );
  }

  // Overflow detection: any descendant sticking outside the card is a clipped-text bug
  // unless it opted in via a bleed/boogie class.
  const overflow = await card.evaluate((el) => {
    const cb = el.getBoundingClientRect();
    const bad = [];
    // Intentional bleeds. Matched with closest() so that children of a bleeding
    // container (e.g. the <img> inside .boogie) inherit the exemption — matching
    // on the element's own class alone flags them as violations.
    // .char-credit is deliberately NOT exempt: the copyright notice must stay
    // inside the safe area to remain legible.
    const BLEED = '.boogie, .blob, .cta-band, .half-top, .half-bottom, [class*="bleed-"]';
    for (const child of el.querySelectorAll('*')) {
      if (child.closest(BLEED)) continue;
      const cls = child.className?.toString?.() ?? '';
      const r = child.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < cb.left - 1 || r.right > cb.right + 1 || r.top < cb.top - 1 || r.bottom > cb.bottom + 1) {
        bad.push(`${child.tagName.toLowerCase()}.${cls || '(no class)'}`);
      }
    }
    return bad;
  });

  if (overflow.length) failures.push(`card ${n}: overflows frame — ${overflow.join(', ')}`);

  // Collision with the fixed lockup / pager. Content that grows under the logo
  // stays inside the frame, so the overflow check above cannot see it.
  const collisions = await card.evaluate((el) => {
    const hits = [];
    // .photo counts as an anchor: collage may overlap type, but never the fixed
    // lockup/pager, and the lockup must never sit on a photo.
    const anchors = [...el.querySelectorAll('.lockup, .pager, .cta-band, .photo')];
    const content = [...el.querySelectorAll('.display, .sub, .body, .label, .step, .quote-box, .char-credit')];
    const overlaps = (a, b) =>
      a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;

    for (const anchor of anchors) {
      const ar = anchor.getBoundingClientRect();
      for (const c of content) {
        if (anchor.contains(c) || c.contains(anchor)) continue;
        const cr = c.getBoundingClientRect();
        if (cr.width === 0 || cr.height === 0) continue;
        if (overlaps(ar, cr)) {
          hits.push(`${c.className.toString().split(' ').slice(0, 2).join('.')} over .${anchor.className}`);
        }
      }
    }
    return [...new Set(hits)];
  });

  if (collisions.length) failures.push(`card ${n}: collides with lockup/pager — ${collisions.join(', ')}`);

  // Licence guards for the Busan city character. These are not style nits:
  // shipping either one is a violation of the published usage rules.
  const licence = await card.evaluate((el) => {
    const problems = [];
    const chars = [...el.querySelectorAll('.boogie')];

    for (const c of chars) {
      const t = getComputedStyle(c).transform;
      const m = t && t !== 'none' ? t.match(/matrix\(([^)]+)\)/) : null;
      if (m) {
        const [a, b, cc, d] = m[1].split(',').map(parseFloat);
        // A negative determinant means the transform includes a reflection.
        // Testing the determinant (not just `a < 0`) stays correct when the
        // mirror is combined with a rotation.
        if (a * d - b * cc < 0) {
          problems.push('character is mirrored — smart-glasses bar rule violated');
        }
        // Pure rotation keeps |a| == |d|; a mismatch means a non-uniform scale.
        if (Math.abs(Math.hypot(a, b) - Math.hypot(cc, d)) > 0.02) {
          problems.push('character scaled non-uniformly — proportions must stay at spec');
        }
      }

      const img = c.querySelector('img');
      if (img && img.naturalWidth > 0) {
        // Layout box, NOT getBoundingClientRect(): the latter returns the
        // axis-aligned box of a rotated element, so every rotated character
        // would read as distorted.
        const srcRatio = img.naturalWidth / img.naturalHeight;
        const drawnRatio = img.offsetWidth / img.offsetHeight;
        if (Math.abs(srcRatio - drawnRatio) / srcRatio > 0.02) {
          problems.push('character aspect ratio distorted — proportions must stay at spec');
        }
      }
      if (img && !img.complete) problems.push('character image failed to load');
    }

    if (chars.length > 0 && el.querySelectorAll('.char-credit').length === 0) {
      problems.push('character shown without the required .char-credit copyright notice');
    }
    return problems;
  });

  if (licence.length) failures.push(`card ${n}: LICENCE — ${licence.join('; ')}`);

  // Photo provenance. A tour brand promises real places; an invented one is a
  // misrepresented deliverable, not a style choice (ADR-010).
  const photos = await card.evaluate((el) =>
    [...el.querySelectorAll('.photo img')].map((img) => ({
      key: img.dataset.photo ?? null,
      slot: img.dataset.slot ?? null,
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
    })),
  );

  const hasCredit = await card.evaluate((el) => el.querySelectorAll('.photo-credit').length > 0);

  for (const p of photos) {
    const where = p.key ?? p.src ?? '(no src)';
    if (!p.loaded) failures.push(`card ${n}: PHOTO — ${where} failed to load`);
    if (!p.key || !p.slot) {
      failures.push(`card ${n}: PHOTO — ${where} is missing data-photo/data-slot`);
      continue;
    }
    const entry = photoIndex.get(p.key);
    if (!entry) {
      failures.push(`card ${n}: PHOTO — "${p.key}" is not in ${manifestPath}`);
      continue;
    }
    if (entry.slot !== p.slot) {
      failures.push(`card ${n}: PHOTO — "${p.key}" is slot "${entry.slot}" in the manifest, used as "${p.slot}"`);
    }
    if (p.slot === 'place' && entry.ai_generated) {
      failures.push(
        `card ${n}: PHOTO — "${p.key}" is AI-generated and cannot fill a place slot (ADR-010)`,
      );
    }
    // Stock and licensed images carry attribution obligations. Own photos and
    // AI concept art do not — their provenance lives in the manifest instead of
    // cluttering the card.
    const rights = entry.rights ?? '';
    if (/^(unsplash|licensed:)/.test(rights) && !hasCredit) {
      failures.push(`card ${n}: PHOTO — "${p.key}" is ${rights} and needs a .photo-credit on the card`);
    }
  }

  const file = `${outDir}/${n}.png`;
  await card.screenshot({ path: file });
  report.push({ card: n, file, overflow });
  console.log(`rendered ${file}`);
}

await browser.close();

console.log(`\n${cards.length} card(s) -> ${outDir}`);

if (failures.length) {
  console.error('\nISSUES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('no issues detected');
