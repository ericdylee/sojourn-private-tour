import { wordCount } from './reel-plan.mjs';
import { checkContrast } from './contrast.mjs';
import { seekTo } from './reel-capture.mjs';

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

/* seekTo(page, 0) rewinds every animation to its own from-keyframe, including
 * finite entrance flourishes like reel.css's .m-type-in (fades .display/.sub
 * in from opacity:0 over ~400-560ms) — that is not the same moment as "the
 * scene has settled and the words are actually on screen". Landing the first
 * sample mid-fade reads as text with full-strength ink over ~0 opacity —
 * contrast.mjs's `invisible` flag checks the element's static `color` alpha,
 * not the ancestor Animation's opacity folded into the ratio math, so this
 * comes back "worst 1.00:1", a CONTRAST fail — for a reason that has nothing
 * to do with what sits behind the type. Every scene that uses the standard
 * entrance treatment would trip this at t=0, which makes the check noise, not
 * signal. Telling "entrance flourish" apart from "the camera move this check
 * exists to watch" needs no reel.css-specific knowledge: ken-burns spans the
 * WHOLE scene (its animation's active duration equals durationMs); a
 * flourish's does not. */
async function settledStart(page, durationMs) {
  return page.evaluate((total) => {
    let end = 0;
    for (const a of document.getAnimations()) {
      const t = a.effect?.getComputedTiming?.();
      if (!t || !Number.isFinite(t.activeDuration) || t.activeDuration >= total) continue;
      end = Math.max(end, (t.delay || 0) + t.activeDuration);
    }
    return Math.min(end, total);
  }, durationMs);
}

/* Three samples, worst wins.
 *
 * A still frame measurement is the wrong measurement here: ken-burns changes
 * what sits behind the type for the whole scene. QA caught exactly this class
 * on the cards (M1 — the URL at 1.75:1 over a bright roof) and that was a
 * STILL image. Moving makes it easier to miss, not harder.
 *
 * The samples deliberately include the last frame: the end state is where a
 * zoom has moved the background furthest from what the author saw. */
export async function checkContrastOverTime(page, el, { label, durationMs }) {
  const start = await settledStart(page, durationMs);
  const marks = [start, Math.round(durationMs / 2), Math.max(0, durationMs - 1)];
  const seen = new Map();
  const notes = [];

  for (const t of marks) {
    await seekTo(page, t);
    const r = await checkContrast(page, el, { label: `${label} @${t}ms` });
    // Same defect at three timestamps is one defect. Key on everything after
    // the timestamp so the dedup does not collapse genuinely different spots.
    for (const i of r.issues) {
      const key = i.replace(/ @\d+ms/, '');
      if (!seen.has(key)) seen.set(key, i);
    }
    notes.push(...r.notes);
  }

  return { issues: [...seen.values()], notes };
}
