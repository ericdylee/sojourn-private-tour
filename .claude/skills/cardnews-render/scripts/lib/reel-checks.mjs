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

/* Elements whose meaning depends on staying on one line. An allowlist, never a
 * sweep — `.display` and `.sub` are multi-line by design, and a wrapped
 * `.photo-credit` is still a readable credit.
 *
 * In the reel that leaves exactly one: the URL, which lives in `.sub strong`.
 * It is the only string on screen a viewer has to transcribe by hand, and a URL
 * broken across two lines is a mistyped URL. The reel's selector is NOT
 * `.cta-band .url` — that is the card system's furniture (APPEARANCE.singleLine
 * in lib/contrast.mjs), and reel.css has no `.cta-band`, no `.url`, no `.pager`
 * and no `.lockup`. Importing that list would have advertised a check running
 * against five selectors this renderer never emits, i.e. a check that always
 * finds nothing. Measured on live scene 05 before this was wired: a campaign
 * path of `www.sojournkorea.net/private-tour/busan-full-day-with-driver` split
 * across two visual line boxes with every other check reporting zero issues.
 *
 * Authors can opt anything else in with data-oneline, or out with
 * data-allow-wrap — the same vocabulary render-cards.mjs uses, on purpose. */
export const SINGLE_LINE = ['.sub strong'];

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

/* Line boxes are counted off Range rects around each target's own text, NOT
 * el.getClientRects(): an inline `<strong>` inside a wrapping paragraph reports
 * one client rect per line anyway, but a blockified or flex child reports a
 * single box no matter how many lines the text inside occupies. A range over
 * the text node returns one rect per line box, which is the thing we want to
 * know. Same method as render-cards.mjs's APPEARANCE 1 check — the defect it
 * was written for (QA T1: card 06's URL breaking mid-word) is the same defect. */
export async function checkSingleLine(el, { label, selectors = SINGLE_LINE } = {}) {
  const bad = await el.evaluate((node, sel) => {
    const targets = new Map();
    for (const t of node.querySelectorAll(sel.join(','))) targets.set(t, 'single-line by brand rule');
    for (const t of node.querySelectorAll('[data-oneline]')) {
      if (!targets.has(t)) targets.set(t, 'data-oneline');
    }

    const out = [];
    for (const [t, why] of targets) {
      if (t.hasAttribute('data-allow-wrap')) continue;
      const cs = getComputedStyle(t);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;

      const tops = [];
      let text = '';
      for (const child of t.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE || !child.nodeValue.trim()) continue;
        text += `${child.nodeValue.trim()} `;
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          // Cluster by line box: the same line can differ by a pixel or two
          // between glyph runs, but a real wrap moves by a full line-height.
          if (!tops.some((v) => Math.abs(v - r.top) < 4)) tops.push(r.top);
        }
      }
      if (!text.trim()) continue;

      const cls = t.className?.toString?.().trim().split(/\s+/).join('.') ?? '';
      const who = `${t.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
      const snip = text.trim().slice(0, 56);

      if (tops.length > 1) out.push(`${who} wrapped onto ${tops.length} lines (${why}) — "${snip}"`);
      // white-space:nowrap does not fix a wrap, it converts it into a silent
      // overrun of the element's own box. Inline elements report clientWidth 0
      // and are skipped, which is correct: they have no box to overrun.
      if (t.clientWidth > 0 && t.scrollWidth - t.clientWidth > 2) {
        out.push(`${who} overruns its own box by ${t.scrollWidth - t.clientWidth}px (${why}) — "${snip}"`);
      }
    }
    return out;
  }, selectors);

  return bad.map((b) => `${label}: LINES — ${b}`);
}

/* WHY THERE IS NO OVERFLOW CHECK HERE, and why that is a decision rather than
 * an omission.
 *
 * The implementation plan's reuse table listed an overflow check alongside the
 * contrast and photo checks, and it was never wired. Re-examined at the final
 * review and deliberately left out: `.reel-scene` is a column flex box with
 * `justify-content: flex-end`, so `.type` grows UPWARD. A headline too tall for
 * its slot does not spill out of the bottom of the frame — it pushes its own
 * top edge up into the 200px band, and checkSafeArea fires first, naming the
 * element and the number of pixels. Measured on the live reel (04_reel.html,
 * all five scenes): the tallest type block is 384px high and its top edge sits
 * 864px clear of the 200px limit — the thinnest of the five margins. The type
 * would have to more than triple in height before an overflow check had
 * anything to say that checkSafeArea had not already said louder.
 *
 * What would change this: a scene layout that pins type to the TOP, or any use
 * of position:absolute for the type block. Either breaks the "grows upward"
 * property this rests on, and then an overflow check earns its place. */

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

/**
 * The scene ledger and the scene markup must name the SAME photograph.
 *
 * This is the seam the publication gate stands on. `render-reel.mjs` builds its
 * `rights` list from `plan.scenes[].photo` — the JSON ledger — and hands that to
 * `decideGate`, which is the only place a licence is ever judged. The frames,
 * meanwhile, come from whatever `<img data-photo>` the HTML carries.
 * `checkPhotos` inspects that img for manifest presence, slot, AI-generation
 * and credit, but it has no licence rule at all. So until this check existed,
 * the gate cleared one file while the encoder photographed another and nothing
 * reconciled them.
 *
 * Reproduced before the fix: scene 01's `<img>` pointed at
 * `place/gamcheon-hero-src.jpg` (CC BY-SA 2.0, in the manifest, on disk) while
 * the plan still named the CC BY 4.0 file. With QA at PASS the run printed
 * `GATE: 발행 가능`, raised zero issues, and wrote a publishable `reel.mp4`
 * whose every scene-01 frame is a ShareAlike photograph — under a credit line
 * that named the wrong photographer and the wrong licence. Five orphaned
 * CC BY-SA 2.0 Gamcheon rows sit in the manifest today with names one character
 * apart from the ones in use, so this is a typo away, not a conspiracy.
 *
 * It also closes a cache hole: `sceneKey` hashes the bytes of the PLAN's photo.
 * If the HTML pointed somewhere else, replacing the bytes of the file actually
 * being photographed changed no input to the key, and every run reported a hit
 * on frames that no longer matched their source. Forcing the two to agree makes
 * the hashed file and the rendered file the same file.
 *
 * Every `<img>` in the scene is checked, not just `.photo img`: an image
 * smuggled in outside a `.photo` wrapper is invisible to checkPhotos, and that
 * would be a photograph nobody cleared at all.
 */
export async function checkPlanPhoto(el, { label, planPhoto }) {
  const imgs = await el.evaluate((node) =>
    [...node.querySelectorAll('img')].map((img) => ({
      key: img.dataset.photo ?? null,
      src: img.getAttribute('src'),
    })),
  );

  const issues = [];
  const expected = planPhoto ?? null;

  if (imgs.length === 0) {
    if (expected) {
      issues.push(
        `${label}: PHOTO — 원장은 "${expected}"를 쓰라고 하는데 HTML에 <img>가 없다`,
      );
    }
    return issues;
  }

  if (imgs.length > 1) {
    // The gate clears one photo per scene because the plan records one. A
    // second image is a second licence nobody was asked about.
    issues.push(
      `${label}: PHOTO — HTML에 <img>가 ${imgs.length}개다. 씬 원장은 사진 하나만 기재하므로 ` +
        `나머지는 발행 게이트가 권리를 판정하지 않은 사진이 된다 — ${imgs.map((i) => i.key ?? i.src ?? '(no src)').join(', ')}`,
    );
  }

  for (const img of imgs) {
    if (!img.key) {
      issues.push(
        `${label}: PHOTO — <img src="${img.src ?? '(no src)'}">에 data-photo가 없어 원장과 대조할 수 없다`,
      );
      continue;
    }
    if (img.key !== expected) {
      issues.push(
        `${label}: PHOTO — 원장과 HTML이 다른 사진을 가리킨다. 원장 "${expected ?? '(없음)'}" vs HTML "${img.key}". ` +
          `발행 게이트는 원장 쪽 라이선스를 보고, 프레임에 찍히는 것은 HTML 쪽이다 — 둘이 갈라지면 게이트가 ` +
          `검사하지 않은 사진이 영상에 들어간다`,
      );
    }
  }

  return issues;
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
