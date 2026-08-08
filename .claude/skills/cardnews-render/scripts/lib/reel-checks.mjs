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

/* One property, deliberately. This is not a typography audit — it is a guard on
 * a single rule that was found leaking and that nothing else could see.
 *
 * brand.css:109-111 sets `.display { text-transform: uppercase }` for the
 * Anton-era card display. reel.css re-declares the whole face and has to reset
 * it, because the reel's entire premise is that it re-typesets the SAME
 * sentences the cards carry — sentence case is the copy QA approved, so
 * uppercase is a rewrite, not a move. It also widens a line by ~23%: measured
 * on the live reel, three of five headlines folded from two lines to three.
 *
 * It gets its own check because it is invisible to every other one. Uppercase
 * is a perfectly legal layout: checkSafeArea and checkWordCount both return
 * zero issues on the leaking variant (reviewer reproduced this by injecting
 * `text-transform: uppercase !important` on the real page). So the defect does
 * not block — it ships. This pipeline renders through CSS and Playwright rather
 * than compositing in ffmpeg precisely so the result stays inspectable, and a
 * defect that ships silently is the one case that argument does not cover. */
export async function checkTextTransform(el, { label }) {
  const bad = await el.evaluate((node) =>
    [...node.querySelectorAll('.display')]
      .map((d) => getComputedStyle(d).textTransform)
      .filter((v) => v !== 'none'),
  );

  return bad.map(
    (v) =>
      `${label}: TYPE — .display is text-transform:${v}, expected none. The reel re-typesets the ` +
      `card sentences verbatim; brand.css uppercases .display for a card-era reason that does not ` +
      `hold here, so dropping reel.css's reset changes how the approved copy reads.`,
  );
}

/* reel.css's only entrance treatment is `typein 400ms` with a 160ms stagger
 * (.delay-1), so 560ms is when the type is fully on screen. Sampling before
 * that measures a fade, not a background. Quartered so a short scene still
 * gets three separated marks.
 *
 * A first version of this derived the start mark from document.getAnimations()
 * instead of a constant, to avoid hardcoding reel.css's numbers. Review found
 * two ways that was worse: (a) a scene author is free to stagger a second line
 * past 560ms (reel.css's own idiom, just slower), which pushed the derived
 * start past a real early defect and reported zero issues where the literal
 * marks caught one at 1.00:1; (b) it queried document.getAnimations() — the
 * whole page, not the element — and Task 10 puts every scene of a reel on one
 * page, so a neighbouring scene's shorter ken-burns duration counted as
 * "finite relative to this scene" and pushed the start mark out by however
 * long that neighbour happened to run. Scoping the query to the element fixes
 * (b) but not (a). A plain constant is immune to both, at the cost of a
 * residual, now-bounded and documented hole: see below. */
const ENTRANCE_MS = 560;

// Element identity: strip the sample's timestamp, then keep everything through
// the closing quote of the element's quoted text. Two different elements never
// share a quoted text run; the same element's message varies mark to mark only
// in the numbers that follow it (timestamp, `worst X:1`, area share) — which a
// moving background changes ON PURPOSE, so none of that belongs in the key.
// (The naive "strip only the timestamp" key from the first version left those
// numbers in, so the same element failing at three different marks against a
// moving background — the exact case this check exists for — produced three
// uncollapsed strings, not one.)
function dedupKey(msg) {
  const stripped = msg.replace(/ @\d+ms/, '');
  const m = /^(.*?"[^"]*")/.exec(stripped);
  return m ? m[1] : stripped;
}

// Worst (lowest) ratio wins over first-seen, so three samples at one spot
// report the single frame that actually failed, not whichever mark happened
// to run first. The transparent-colour/no-text-stroke variant (contrast.mjs)
// has no `worst X:1` to compare — when either side lacks one, first-seen
// stands rather than guessing.
function keepWorst(map, key, msg) {
  const prev = map.get(key);
  if (!prev) {
    map.set(key, msg);
    return;
  }
  const prevWorst = /worst ([\d.]+):1/.exec(prev);
  const curWorst = /worst ([\d.]+):1/.exec(msg);
  if (prevWorst && curWorst && parseFloat(curWorst[1]) < parseFloat(prevWorst[1])) {
    map.set(key, msg);
  }
}

/* Three samples, worst wins.
 *
 * A still frame measurement is the wrong measurement here: ken-burns changes
 * what sits behind the type for the whole scene. QA caught exactly this class
 * on the cards (M1 — the URL at 1.75:1 over a bright roof) and that was a
 * STILL image. Moving makes it easier to miss, not harder.
 *
 * The samples deliberately include the last frame: the end state is where a
 * zoom has moved the background furthest from what the author saw. The first
 * sample is ENTRANCE_MS, not literal 0 — reel.css's type fades in from
 * opacity:0, and seeking to true zero measures that fade, not a background
 * (verified against scenes-ok.html; see task-7-report.md).
 *
 * Residual hole, bounded and left in on purpose rather than silently reopened:
 * a defect confined entirely to [0, ENTRANCE_MS) that has already cleared by
 * the first sample goes unseen. Ken-burns is a linear ~8% zoom over the WHOLE
 * scene and cannot produce one; a cut or a wipe could, and reel.css has
 * neither. If reel.css ever grows a fourth entrance primitive, ENTRANCE_MS
 * needs to move with it — see the comment on @keyframes typein. */
export async function checkContrastOverTime(page, el, { label, durationMs }) {
  const start = Math.min(ENTRANCE_MS, Math.round(durationMs / 4));
  const marks = [start, Math.round(durationMs / 2), Math.max(0, durationMs - 1)];
  const seenIssues = new Map();
  const seenNotes = new Map();

  for (const t of marks) {
    await seekTo(page, t);
    const r = await checkContrast(page, el, { label: `${label} @${t}ms` });
    for (const i of r.issues) keepWorst(seenIssues, dedupKey(i), i);
    for (const n of r.notes) keepWorst(seenNotes, dedupKey(n), n);
  }

  return { issues: [...seenIssues.values()], notes: [...seenNotes.values()] };
}
