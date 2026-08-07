import { wordCount } from './reel-plan.mjs';

/* Instagram's own chrome covers these bands: the account row at the top, the
 * caption and action buttons at the bottom. Anything that must be READ has to
 * stay out of them. Decoration and the photograph may run through. */
export const SAFE = { top: 200, bottom: 400 };

/* "Never put more than six words on screen at once" — a vertical screen at
 * arm's length cannot deliver more in the time a scene lasts. Applies to the
 * headline: the support line is read second, not simultaneously. */
export const MAX_HEADLINE_WORDS = 6;

const READABLE = '.display, .sub, .photo-credit, .cta-band, .badge, .label';

export async function checkSafeArea(el, { label }) {
  const bad = await el.evaluate(
    (node, { safe, sel }) => {
      const frame = node.getBoundingClientRect();
      const out = [];
      for (const child of node.querySelectorAll(sel)) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const top = r.top - frame.top;
        const bottom = frame.bottom - r.bottom;
        const cls = child.className?.toString?.().trim().replace(/\s+/g, '.') ?? '';
        const who = `${child.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
        // 1px of slack: a layout that sits exactly on the boundary (the default
        // padding does) must not fail on sub-pixel rounding.
        if (top < safe.top - 1) out.push(`${who} is ${Math.round(safe.top - top)}px into the top ${safe.top}px band`);
        if (bottom < safe.bottom - 1) out.push(`${who} is ${Math.round(safe.bottom - bottom)}px into the bottom ${safe.bottom}px band`);
      }
      return out;
    },
    { safe: SAFE, sel: READABLE },
  );

  return bad.map((b) => `${label}: SAFE AREA — ${b}`);
}

export async function checkWordCount(el, { label }) {
  const text = await el.evaluate((node) => node.querySelector('.display')?.textContent ?? '');
  const n = wordCount(text);
  // A scene with no .display (or an empty one) has no headline at all. None of
  // the other checks catch this — safe-area finds nothing to violate, the
  // photo check is about images, contrast finds no ink to measure — so a
  // silent photo-only frame would otherwise sail through every gate.
  if (n === 0) return [`${label}: HEADLINE — .display is missing or has no text`];
  if (n <= MAX_HEADLINE_WORDS) return [];
  return [`${label}: WORDS — headline is ${n} words, limit is ${MAX_HEADLINE_WORDS} ("${text.trim()}")`];
}
