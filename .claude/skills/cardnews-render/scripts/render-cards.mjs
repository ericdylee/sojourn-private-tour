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
const APPEARANCE = {
  /* Elements whose meaning depends on staying on one line. A wrapped URL is a
   * mistyped URL; a wrapped lockup or pager breaks the fixed furniture that
   * ties the six cards into one set. Everything else — display copy above all —
   * is multi-line by design, so this list is an allowlist, never a sweep.
   * Authors can opt anything else in with data-oneline, or out with
   * data-allow-wrap. */
  singleLine: ['.cta-band .url', '.cta-band .go', '.pager', '.lockup .mark', '.lockup .handle'],

  /* Contrast thresholds. Deliberately NOT WCAG AA (4.5:1). This check exists to
   * catch text that is LOST, not to audit accessibility: at 4.5 the standard
   * lockup handle (white @0.7 on brand blue = 4.23:1) would warn on all six
   * cards and the whole thing gets tuned out. 3.0 leaves every brand-standard
   * treatment quiet — coral on white 3.42, white on coral 3.42, ink @0.55 on
   * white 4.37 — while 2.0 still fires on the failures that matter (white on
   * white 1.0, white on sand 1.65, coral on ink 1.85). */
  contrastFail: 2.0,
  contrastWarn: 3.0,

  /* Gradients and photos: the background under one word is not one colour, so
   * the verdict is by AREA. Contrast is computed per sampled pixel and judged
   * on the share of the text's footprint that falls below the threshold. On a
   * flat background the share is 0 or 1 and this degenerates to a plain
   * threshold; over a gradient or a photo it takes a quarter of the word to be
   * unreadable before failing, because a minority of low-contrast pixels under
   * a display word is normal (and what .t-outline's stroke exists for). */
  badAreaShare: 0.25,
};

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

  // APPEARANCE 2 — text/background contrast.
  //
  // Measured against the rendered pixels, not against an ancestor walk. The
  // card 02 pager vanished under .half-bottom, which is a SIBLING that paints
  // over it — no walk up the tree can see that plane. So: screenshot the card
  // once with every glyph turned transparent, and read the real background out
  // from under each piece of text. Backgrounds, box-shadows and photos all stay
  // painted; only the ink goes away.
  const inkSpots = await card.evaluate((el) => {
    const cardRect = el.getBoundingClientRect();
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c ?? '');
      if (!m) return null;
      const p = m[1].split(',').map(parseFloat);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };

    // One entry per element that owns text, keyed off its own text nodes so a
    // container is never charged for the area of a differently-coloured child.
    const byOwner = new Map();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue.trim()) continue;
      const owner = node.parentElement;
      if (!owner) continue;
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(node);
    }

    const out = [];
    let id = 0;
    for (const [owner, nodes] of byOwner) {
      const cs = getComputedStyle(owner);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      // Element opacity is how this brand dims the pager, the handle and the
      // attributions — it must be folded into the ink or every one of them
      // reads as full strength and the check misses the faint cases.
      let opacity = 1;
      for (let a = owner; a && a !== el.parentElement; a = a.parentElement) {
        opacity *= parseFloat(getComputedStyle(a).opacity || '1');
      }

      const rects = [];
      let text = '';
      for (const node of nodes) {
        text += `${node.nodeValue.trim()} `;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width < 1 || r.height < 1) continue;
          rects.push({ x: r.left - cardRect.left, y: r.top - cardRect.top, w: r.width, h: r.height });
        }
      }
      if (!rects.length) continue;

      // .t-outline paints nothing but a stroke: its `color` is transparent by
      // design, so the stroke is what has to survive against the background.
      let ink = parse(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
      let source = 'color';
      const strokeWidth = parseFloat(cs.webkitTextStrokeWidth || '0');
      const stroke = parse(cs.webkitTextStrokeColor);
      if (ink.a < 0.05 && strokeWidth > 0 && stroke && stroke.a >= 0.05) {
        ink = stroke;
        source = 'text-stroke';
      }

      const cls = owner.className?.toString?.().trim().split(/\s+/).join('.') ?? '';
      owner.setAttribute('data-qa-ink', String(id));
      out.push({
        id: id++,
        label: `${owner.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`,
        text: text.trim().slice(0, 40),
        rects,
        ink: { r: ink.r, g: ink.g, b: ink.b, a: ink.a * opacity },
        source,
        invisible: ink.a < 0.05,
        exempt: owner.getAttribute('data-contrast-exempt'),
      });
    }
    return out;
  });

  if (inkSpots.length) {
    await page.evaluate(() => {
      let s = document.getElementById('__qa_noink');
      if (!s) {
        s = document.createElement('style');
        s.id = '__qa_noink';
        document.head.appendChild(s);
      }
      s.textContent =
        '[data-qa-ink], [data-qa-ink] * { color: transparent !important;' +
        ' -webkit-text-stroke-color: transparent !important; text-shadow: none !important; }';
    });

    const groundShot = await card.screenshot();

    await page.evaluate(() => {
      document.getElementById('__qa_noink').textContent = '';
    });

    // Decoding happens in the browser: it already has a PNG decoder, so this
    // needs no image dependency in the scripts/ bundle.
    const measured = await page.evaluate(
      async ({ b64, spots, cfg }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

        const lin = (v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

        return spots.map((s) => {
          let n = 0;
          let bad = 0;
          let weak = 0;
          let min = Infinity;
          for (const rc of s.rects) {
            const x0 = Math.max(0, Math.floor(rc.x));
            const y0 = Math.max(0, Math.floor(rc.y));
            const x1 = Math.min(canvas.width, Math.ceil(rc.x + rc.w));
            const y1 = Math.min(canvas.height, Math.ceil(rc.y + rc.h));
            const sx = Math.max(1, Math.floor((x1 - x0) / 40));
            const sy = Math.max(1, Math.floor((y1 - y0) / 40));
            for (let y = y0; y < y1; y += sy) {
              for (let x = x0; x < x1; x += sx) {
                const i = (y * canvas.width + x) * 4;
                const br = px[i];
                const bg = px[i + 1];
                const bb = px[i + 2];
                // Semi-transparent ink composites over whatever is behind it,
                // which is exactly how white @0.55 on white becomes white.
                const tr = s.ink.r * s.ink.a + br * (1 - s.ink.a);
                const tg = s.ink.g * s.ink.a + bg * (1 - s.ink.a);
                const tb = s.ink.b * s.ink.a + bb * (1 - s.ink.a);
                const r = ratio(lum(tr, tg, tb), lum(br, bg, bb));
                n += 1;
                if (r < min) min = r;
                if (r < cfg.contrastFail) bad += 1;
                if (r < cfg.contrastWarn) weak += 1;
              }
            }
          }
          return { id: s.id, samples: n, badShare: n ? bad / n : 0, weakShare: n ? weak / n : 0, min };
        });
      },
      { b64: groundShot.toString('base64'), spots: inkSpots, cfg: APPEARANCE },
    );

    await card.evaluate((el) =>
      el.querySelectorAll('[data-qa-ink]').forEach((e) => e.removeAttribute('data-qa-ink')),
    );

    const stats = new Map(measured.map((m) => [m.id, m]));
    for (const spot of inkSpots) {
      const m = stats.get(spot.id);
      if (!m || !m.samples) continue;
      const where = `${spot.label} "${spot.text}"`;

      if (spot.invisible && spot.source !== 'text-stroke') {
        failures.push(`card ${n}: CONTRAST — ${where} has a transparent colour and no text-stroke`);
        continue;
      }
      if (spot.exempt) {
        warnings.push(`card ${n}: contrast exemption claimed on ${where} — ${spot.exempt}`);
        continue;
      }

      const share = (v) => `${Math.round(v * 100)}%`;
      const min = m.min.toFixed(2);
      if (m.badShare >= APPEARANCE.badAreaShare) {
        failures.push(
          `card ${n}: CONTRAST — ${where} is below ${APPEARANCE.contrastFail}:1 over ${share(m.badShare)}` +
            ` of its footprint (worst ${min}:1, ink from ${spot.source})`,
        );
      } else if (m.weakShare >= APPEARANCE.badAreaShare) {
        warnings.push(
          `card ${n}: ${where} is below ${APPEARANCE.contrastWarn}:1 over ${share(m.weakShare)}` +
            ` of its footprint (worst ${min}:1)`,
        );
      }
    }
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
