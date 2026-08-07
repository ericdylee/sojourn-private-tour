/**
 * Text/background contrast, measured against rendered pixels.
 *
 * Extracted from render-cards.mjs so the reel renderer can reuse it. The method
 * is unchanged: screenshot the frame once with every glyph turned transparent,
 * then read the real background out from under each piece of text. An ancestor
 * walk cannot do this — the card 02 pager vanished under a SIBLING that painted
 * over it, and no walk up the tree can see that plane.
 *
 * Thresholds are ADR-014 and are not accessibility thresholds. The job is to
 * catch text that is LOST, not to audit WCAG. Do not raise them without
 * revisiting that ADR.
 */
export const APPEARANCE = {
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

export async function checkContrast(page, el, { label, config = APPEARANCE } = {}) {
  const issues = [];
  const notes = [];

  // APPEARANCE 2 — text/background contrast.
  //
  // Measured against the rendered pixels, not against an ancestor walk. The
  // card 02 pager vanished under .half-bottom, which is a SIBLING that paints
  // over it — no walk up the tree can see that plane. So: screenshot the card
  // once with every glyph turned transparent, and read the real background out
  // from under each piece of text. Backgrounds, box-shadows and photos all stay
  // painted; only the ink goes away.
  const inkSpots = await el.evaluate((el) => {
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

    const groundShot = await el.screenshot();

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
      { b64: groundShot.toString('base64'), spots: inkSpots, cfg: config },
    );

    await el.evaluate((el) =>
      el.querySelectorAll('[data-qa-ink]').forEach((e) => e.removeAttribute('data-qa-ink')),
    );

    const stats = new Map(measured.map((m) => [m.id, m]));
    for (const spot of inkSpots) {
      const m = stats.get(spot.id);
      if (!m || !m.samples) continue;
      const where = `${spot.label} "${spot.text}"`;

      if (spot.invisible && spot.source !== 'text-stroke') {
        issues.push(`${label}: CONTRAST — ${where} has a transparent colour and no text-stroke`);
        continue;
      }
      if (spot.exempt) {
        notes.push(`${label}: contrast exemption claimed on ${where} — ${spot.exempt}`);
        continue;
      }

      const share = (v) => `${Math.round(v * 100)}%`;
      const min = m.min.toFixed(2);
      if (m.badShare >= config.badAreaShare) {
        issues.push(
          `${label}: CONTRAST — ${where} is below ${config.contrastFail}:1 over ${share(m.badShare)}` +
            ` of its footprint (worst ${min}:1, ink from ${spot.source})`,
        );
      } else if (m.weakShare >= config.badAreaShare) {
        notes.push(
          `${label}: ${where} is below ${config.contrastWarn}:1 over ${share(m.weakShare)}` +
            ` of its footprint (worst ${min}:1)`,
        );
      }
    }
  }

  return { issues, notes };
}
