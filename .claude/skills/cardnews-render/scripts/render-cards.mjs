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
import { mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPEARANCE, checkContrast } from './lib/contrast.mjs';
import { loadPhotoIndex, checkPhotos } from './lib/photos.mjs';

const CARD = 1080;

/* ---------------------------------------------------------------------------
 * Appearance checks (added after QA T1).
 *
 * Every other check in this file is geometry or metadata: is the card 1080²,
 * did something leave the frame, is the photo on the ledger. None of them can
 * see how a card READS, and two defects shipped past exit 0 because of it —
 * the card 06 URL breaking mid-word, and the card 02 pager rendering white on
 * white. A line break is the OPPOSITE of an overflow (the text folds and stays
 * inside the frame), so widening the overflow check could never have caught
 * either one. They need checks of a different kind.
 *
 * Design rule for both: a check people ignore is worse than no check. Only
 * things that are certainly broken exit non-zero; anything arguable prints as
 * a NOTE and leaves the exit code alone.
 * ------------------------------------------------------------------------ */
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

const { photoIndex, manifestPath } = await loadPhotoIndex(manifestArg);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: CARD, height: CARD },
  deviceScaleFactor: 1,
});

const failures = [];
const warnings = [];

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
    // .doodle joins the list for the same reason .blob is on it: a decorative
    // mark that stops dead at the frame edge looks cropped, not drawn. Its SVG
    // children inherit the exemption through closest().
    const BLEED = '.boogie, .blob, .doodle, .wave, .cta-band, .half-top, .half-bottom, [class*="bleed-"]';

    // An element cannot leak out of the frame through an ancestor that clips it.
    // A background photo scaled up inside .photo's overflow:hidden reports a
    // rect wider than the card, but not one pixel of it is painted there — that
    // IS the crop. Stop at the card itself: .card is overflow:hidden too, so
    // counting it would turn this whole check into a no-op. The clipping
    // ancestor is in the same sweep and gets tested on its own account.
    const clipped = (node) => {
      for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') return true;
      }
      return false;
    };

    for (const child of el.querySelectorAll('*')) {
      if (child.closest(BLEED)) continue;
      if (clipped(child)) continue;
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
    // A collage photo counts as an anchor: it is an object ON the card, and
    // type running into it is a layout bug. A BACKGROUND photo is the opposite
    // — the card is the photograph and the type is meant to be on it — so
    // .photo-bg is excluded here. It stays in every other check: manifest
    // registration, slot, the AI-in-a-place-slot ban, the credit requirement.
    // Only this one geometric rule is inverted, and only for that class.
    const anchors = [...el.querySelectorAll('.lockup, .pager, .cta-band, .photo:not(.photo-bg)')];
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

    // Doodles are held to a narrower rule than type is. Drawing them over a
    // photo or over a display word is the collage language working as intended,
    // so they are not in `content` above. Drawing them over the lockup or the
    // pager is not: that furniture is identical on all six cards, and a scribble
    // through it is the one place a decorative mark can damage the set.
    for (const d of el.querySelectorAll('.doodle')) {
      const dr = d.getBoundingClientRect();
      if (dr.width === 0 || dr.height === 0) continue;
      for (const fixed of el.querySelectorAll('.lockup, .pager')) {
        if (overlaps(dr, fixed.getBoundingClientRect())) {
          hits.push(`.doodle over .${fixed.className}`);
        }
      }
    }
    return [...new Set(hits)];
  });

  if (collisions.length) failures.push(`card ${n}: collides with lockup/pager — ${collisions.join(', ')}`);

  // APPEARANCE 1 — unintended line breaks.
  //
  // Counted off Range rects around the element's own text, NOT
  // el.getClientRects(): .url and .go are flex items, so they are blockified
  // and their own client rect is always exactly one box no matter how many
  // lines the text inside occupies. A range over the text node returns one
  // rect per line box, which is the thing we actually want to know.
  const lineBreaks = await card.evaluate((el, cfg) => {
    const targets = new Map();
    for (const t of el.querySelectorAll(cfg.singleLine.join(','))) {
      targets.set(t, 'single-line by brand rule');
    }
    for (const t of el.querySelectorAll('*')) {
      if (targets.has(t)) continue;
      if (t.hasAttribute('data-oneline')) targets.set(t, 'data-oneline');
      else {
        // An author who wrote white-space:nowrap declared single-line intent.
        // Verify the declaration actually held — a <br> still breaks under it.
        const ws = getComputedStyle(t).whiteSpace;
        if (ws === 'nowrap' || ws === 'pre') targets.set(t, `white-space:${ws}`);
      }
    }

    const out = [];
    for (const [t, why] of targets) {
      if (t.hasAttribute('data-allow-wrap')) continue;
      const cs = getComputedStyle(t);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      const tops = [];
      let text = '';
      for (const node of t.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue.trim()) continue;
        text += `${node.nodeValue.trim()} `;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          // Cluster by line box: same line, different glyph metrics can differ
          // by a pixel or two, but a real wrap moves by a full line-height.
          if (!tops.some((v) => Math.abs(v - r.top) < 4)) tops.push(r.top);
        }
      }
      if (!text.trim()) continue;

      const cls = t.className?.toString?.().trim().split(/\s+/).join('.') ?? '';
      const label = `${t.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
      const snip = text.trim().slice(0, 56);

      if (tops.length > 1) {
        out.push(`${label} wrapped onto ${tops.length} lines (${why}) — "${snip}"`);
      }
      // nowrap does not fix a wrap, it converts it into a silent overrun of the
      // element's own box. The frame-overflow check cannot see that: .cta-band
      // is a declared bleed, so everything inside it is exempt.
      if (t.clientWidth > 0 && t.scrollWidth - t.clientWidth > 2) {
        out.push(
          `${label} overruns its own box by ${t.scrollWidth - t.clientWidth}px (${why}) — "${snip}"`,
        );
      }
    }
    return out;
  }, APPEARANCE);

  if (lineBreaks.length) failures.push(`card ${n}: LINES — ${lineBreaks.join('; ')}`);

  // APPEARANCE 2 — text/background contrast. Extracted to lib/contrast.mjs so
  // the reel renderer can reuse the same multi-phase routine.
  {
    const { issues, notes } = await checkContrast(page, card, { label: `card ${n}` });
    failures.push(...issues);
    warnings.push(...notes);
  }

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

  // Photo provenance. Extracted to lib/photos.mjs so the reel renderer can
  // reuse the same manifest-backed check.
  failures.push(...(await checkPhotos(card, { photoIndex, manifestPath, label: `card ${n}` })));

  const file = `${outDir}/${n}.png`;
  await card.screenshot({ path: file });
  report.push({ card: n, file, overflow });
  console.log(`rendered ${file}`);
}

await browser.close();

console.log(`\n${cards.length} card(s) -> ${outDir}`);

// Notes are printed whether or not the run failed, and never change the exit
// code. They are the arguable half of the appearance checks — marginal contrast
// on a brand treatment, a claimed exemption — kept separate so that a non-zero
// exit always means something is certainly broken.
if (warnings.length) {
  console.log('\nNOTES (not failures):');
  for (const w of warnings) console.log(`  · ${w}`);
}

if (failures.length) {
  console.error('\nISSUES:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('no issues detected');
