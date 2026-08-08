#!/usr/bin/env node
/**
 * Sojourn reel renderer.
 *
 * Re-typesets the card copy at 1080x1920, captures each scene deterministically
 * and writes output/reels/reel.mp4.
 *
 * Usage (from the repo root):
 *   node .claude/skills/cardnews-render/scripts/render-reel.mjs \
 *        _workspace/04_reel.html _workspace/04_reel_plan.json [outDir]
 *
 * Lives beside render-cards.mjs on purpose: CLAUDE.md names this directory as
 * the one place render dependencies may live, and a second package.json would
 * let the two renderers drift onto different playwright versions.
 *
 * This script never asks a human anything. Scene-plan approval and the crop
 * confirmation are gates the AGENT opens via mcp__gate__ask_approval.
 */
import { chromium } from 'playwright';
import { mkdir, access, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { assertFontsLoaded } from './lib/fonts.mjs';
import { loadPhotoIndex, checkPhotos } from './lib/photos.mjs';
import { loadReelPlan } from './lib/reel-plan.mjs';
import { seekTo, openEncoder, captureScene, probeVideo, verifySceneVideo, FPS, DURATION_TOLERANCE_MS } from './lib/reel-capture.mjs';
import {
  checkSafeArea,
  checkWordCount,
  checkTextTransform,
  checkSingleLine,
  checkPlanPhoto,
  checkContrastOverTime,
} from './lib/reel-checks.mjs';
import { decideGate } from './lib/reel-gate.mjs';
import { sceneKey } from './lib/reel-cache.mjs';

const W = 1080;
const H = 1920;
const MIN_TOTAL_MS = 15000;
const MAX_TOTAL_MS = 25000;

const [, , htmlArg, planArg, outArg] = process.argv;

if (!htmlArg || !planArg) {
  console.error('usage: node render-reel.mjs <reel.html> <reel_plan.json> [outDir]');
  process.exit(2);
}

const htmlPath = resolve(htmlArg);
const planPath = resolve(planArg);
const outDir = resolve(outArg ?? 'output/reels');
const cacheDir = resolve('_workspace/.reel-cache');
const assetsDir = resolve(import.meta.dirname, '../assets');
// One root for both uses below — the file sceneKey hashes and the file
// checkPlanPhoto compares the markup against have to be rooted identically, or
// the check and the cache can disagree about what the ledger even names.
const photosRoot = resolve('assets/photos');

for (const p of [htmlPath, planPath]) {
  try {
    await access(p);
  } catch {
    console.error(`input not found: ${p}`);
    process.exit(2);
  }
}

await mkdir(outDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const issues = [];
const notes = [];

// --- plan ------------------------------------------------------------------
const { plan, issues: planIssues } = await loadReelPlan(planPath);
issues.push(...planIssues);
if (!plan) {
  console.error('\nISSUES:');
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

const fps = plan.fps ?? FPS;

if (plan.total_ms < MIN_TOTAL_MS || plan.total_ms > MAX_TOTAL_MS) {
  notes.push(
    `총 길이 ${(plan.total_ms / 1000).toFixed(1)}초 — 권장 ${MIN_TOTAL_MS / 1000}~${MAX_TOTAL_MS / 1000}초`,
  );
}

// --- gate ------------------------------------------------------------------
const { photoIndex, manifestPath } = await loadPhotoIndex();
// Scene index and photo key ride along so an unresolvable licence names the
// scene to go fix. Only the `rights` field is matched by the gate.
//
// `rights` is built from the PLAN, not from the DOM, and stays that way. The
// verdict is an input to the frames themselves — it decides the burned-in
// banner and is folded into every scene's cache key — so it has to be settled
// before a browser opens, while the DOM does not exist yet. Rebuilding it from
// the DOM would mean opening the page, reading the images, deciding, and only
// then re-navigating to capture: a two-phase render for no extra safety, given
// that checkPlanPhoto (below) makes a plan/DOM disagreement a hard ISSUE.
//
// What that check buys, stated no wider than it is true: for every <img> element
// inside a `section.reel-scene` the plan has a scene for, `data-photo` and the
// browser's resolved fetch (`currentSrc`) must both name the file the plan names,
// and responsive selection (`srcset`, `<picture><source>`) is refused outright.
//
// It does NOT establish that the frames contain only cleared photography. Not
// covered, and none of it is inspected anywhere else either: CSS that paints an
// image — including `content: url(...)` on the <img> ITSELF, which replaces what
// it paints while every label still names the cleared file — plus
// `background-image`, `mask-image`, `border-image`, `image-set()`; painters that
// are not <img> (<canvas>, SVG <image>, <input type="image">, <object>/<embed>/
// <iframe>, <video poster>); <img> inside a shadow root; markup outside those
// sections; and any scene the plan does not list — that last one fails the run
// through the scene-count ISSUE below rather than through this check. Anything
// reaching the encoder by one of those routes is unjudged.
//
// This comment has been narrowed twice, both times after the code under it was
// found to be narrower still. It once said the two sources were "provably the
// same file" while the check compared `data-photo` alone; a second version said
// "a scene where the judged file and the photographed file differ never reaches
// the encoder" while the check compared the `src` ATTRIBUTE, which `srcset`
// walks straight past. Both holes were reproduced end to end — 발행 가능, zero
// issues, a publishable reel.mp4 of a CC BY-SA 2.0 photograph. A guarantee
// written wider than the code is worse than no comment: the next person to touch
// photos believes it, and the belief is what the exploit needs.
const rights = plan.scenes.map((s, i) => ({
  scene: `scene ${String(i + 1).padStart(2, '0')}`,
  photo: s.photo ?? null,
  rights: photoIndex.get(s.photo)?.rights ?? null,
}));
const gate = await decideGate({ qaReportPath: resolve('output/qa_report.md'), rights });

if (gate.internal) {
  console.log('GATE: INTERNAL — 발행본이 나오지 않는다');
  for (const r of gate.reasons) console.log(`  · ${r}`);
} else {
  console.log('GATE: 발행 가능');
}

// The other filename must not linger: a stale reel.mp4 next to a fresh
// reel_INTERNAL.mp4 is exactly the upload accident this gate exists to prevent.
//
// It runs HERE, the moment the verdict is known, and not beside the encode at
// the end of the file. Down there it sat AFTER the issues gate, so the failure
// door walked straight past it — a run whose checks fail prints INTERNAL,
// prints "mp4를 만들지 않는다", exits 1, and leaves last week's publishable
// reel.mp4 sitting in output/reels/ as the newest thing a human sees. Reached
// through the failure path, that is the same accident, and the failure path is
// the likelier one. The verdict alone decides which name is illegitimate; a
// successful encode is not a precondition for deleting it.
await rm(join(outDir, gate.internal ? 'reel.mp4' : 'reel_INTERNAL.mp4'), { force: true });

// --- browser ---------------------------------------------------------------
const browser = await chromium.launch();
const pageOpts = { viewport: { width: W, height: H }, deviceScaleFactor: 1 };

// Capture and inspection get separate pages. The contrast check makes every
// glyph transparent to read the background out from under it; sharing a page
// with the capture loop is how you ship a reel with no text on it.
const capturePage = await browser.newPage(pageOpts);
const checkPage = await browser.newPage(pageOpts);

for (const [name, page] of [['capture', capturePage], ['check', checkPage]]) {
  page.on('console', (m) => {
    if (m.type() === 'error') issues.push(`${name} console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    issues.push(`${name} request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  if (gate.internal) await page.evaluate(() => document.body.classList.add('internal'));
  const missing = await assertFontsLoaded(page);
  for (const f of missing) issues.push(`${name}: FONT — "${f}"가 로드되지 않았다`);
}

const captureScenes = await capturePage.$$('section.reel-scene');
const checkScenes = await checkPage.$$('section.reel-scene');

// Read once, folded into every scene's cache key. The head is shared, so a
// <style> or <link> added to it changes all five scenes while none of their
// own outerHTML moves — the cache-hit-on-stale-frames case reel-cache.mjs
// exists to prevent.
const headHtml = await capturePage.evaluate(() => document.head.innerHTML);

if (captureScenes.length !== plan.scenes.length) {
  issues.push(
    `HTML에 씬이 ${captureScenes.length}개인데 원장은 ${plan.scenes.length}개다`,
  );
}

// --- per scene -------------------------------------------------------------
const sceneFiles = [];

for (const [i, spec] of plan.scenes.entries()) {
  const label = `scene ${String(i + 1).padStart(2, '0')}`;
  const capEl = captureScenes[i];
  const chkEl = checkScenes[i];
  if (!capEl || !chkEl) {
    issues.push(`${label}: HTML에 대응하는 <section class="reel-scene">가 없다`);
    continue;
  }

  const box = await capEl.boundingBox();
  if (!box || Math.round(box.width) !== W || Math.round(box.height) !== H) {
    issues.push(`${label}: expected ${W}x${H}, got ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
  }

  // Every check below measures a settled frame, and "settled" has to be chosen
  // rather than inherited. checkContrastOverTime ends by seeking the whole page
  // to the LAST scene's final mark, so without this line scene n's safe-area
  // and word-count checks would run against a page frozen wherever scene n-1
  // happened to stop — and scene 01's would run against animations still
  // playing in real time, which is not reproducible between runs.
  //
  // Seeking to this scene's own end makes every scene the same measurement:
  // entrance animations complete (animation-fill-mode: both holds the end
  // state) and ken-burns at full extent. It cannot hide a safe-area defect —
  // .m-type-in has finished moving by 560ms and nothing in reel.css moves the
  // type after that — it only stops one from being reported at random.
  await seekTo(checkPage, spec.duration_ms - 1);

  // Checks run on the check page so nothing they touch reaches the frames.
  issues.push(...(await checkSafeArea(chkEl, { label })));
  issues.push(...(await checkWordCount(chkEl, { label })));
  issues.push(...(await checkTextTransform(chkEl, { label })));
  issues.push(...(await checkSingleLine(chkEl, { label })));
  issues.push(...(await checkPhotos(chkEl, { photoIndex, manifestPath, label })));
  // Reconciles the ledger the gate judged against the markup the encoder
  // photographs. Without it the gate can clear one file while another is in
  // every frame — see the comment on checkPlanPhoto.
  issues.push(...(await checkPlanPhoto(chkEl, { label, planPhoto: spec.photo ?? null, photosRoot })));
  const c = await checkContrastOverTime(checkPage, chkEl, { label, durationMs: spec.duration_ms });
  issues.push(...c.issues);
  notes.push(...c.notes);

  // Cache.
  const sceneHtml = await capEl.evaluate((el) => el.outerHTML);
  const photoPath = spec.photo ? resolve(photosRoot, spec.photo) : null;
  // sceneKey reads every file it hashes, so a plan pointing at a photo that is
  // not on disk throws ENOENT from inside it. Unhandled, that ends the process
  // with a stack trace — and the loop's own ISSUES list, which checkPhotos has
  // by then already filled with the friendly version of the same fact, is only
  // printed after the loop, so the crash gets there first. The verdict was
  // never in doubt (exit != 0, no mp4); the point is that the operator should
  // read a sentence, not a trace.
  let key;
  try {
    key = await sceneKey({
      sceneHtml,
      headHtml,
      cssPaths: [join(assetsDir, 'reel.css'), join(assetsDir, 'brand.css')],
      fontDir: join(assetsDir, 'fonts'),
      photoPath,
      durationMs: spec.duration_ms,
      fps,
      internal: gate.internal,
    });
  } catch (e) {
    issues.push(`${label}: CACHE — 씬 캐시 키를 만들 수 없다 — ${e.message}`);
    continue;
  }
  const cached = join(cacheDir, `${key}.mp4`);

  let hit = true;
  try {
    await access(cached);
  } catch {
    hit = false;
  }

  // A file existing at the key is not the same as the SCENE existing there.
  // ffmpeg traps SIGINT and finalises its output, so Ctrl-C during a cold
  // render — the normal way anyone stops a four-minute job — used to leave a
  // structurally valid, playable, SHORT mp4 at a legitimate key. Reproduced:
  // an interrupt partway through scene 04 left 4.033s / 121 frames where 4.5s
  // / 135 belonged; the next run printed `scene 04: cache hit (4500ms)`, exited
  // 0, and shipped a 22.03s reel whose summary line still read 22.5s, because
  // that line echoed plan.total_ms and nothing ever measured the artifact.
  //
  // openEncoder's .part-then-rename stops new entries like that from appearing.
  // This check is what evicts the ones already written, and what catches any
  // other way a cached file drifts from its key (a truncating disk, a manual
  // copy). A mismatch is an ISSUE — so the run fails and a human hears about
  // it — AND the scene re-captures, so the cache is repaired rather than left
  // to fail again tomorrow.
  if (hit) {
    const stale = await verifySceneVideo(cached, { durationMs: spec.duration_ms, fps });
    if (stale.length) {
      issues.push(
        `${label}: CACHE — 캐시된 씬이 규격과 다르다 (${stale.join('; ')}). 지우고 다시 캡처한다`,
      );
      await rm(cached, { force: true });
      hit = false;
    }
  }

  if (hit) {
    console.log(`${label}: cache hit (${spec.duration_ms}ms)`);
  } else {
    const enc = openEncoder(cached, { fps, width: W, height: H });
    const n = await captureScene({
      page: capturePage,
      el: capEl,
      durationMs: spec.duration_ms,
      fps,
      onFrame: enc.write,
    });
    await enc.close();
    // Measured, not counted. `n` is how many screenshots were handed to
    // ffmpeg; this is how many came out the other side.
    const wrong = await verifySceneVideo(cached, { durationMs: spec.duration_ms, fps });
    if (wrong.length) {
      issues.push(`${label}: ENCODE — 캡처 결과가 규격과 다르다 (${wrong.join('; ')})`);
    }
    console.log(`${label}: captured ${n} frames (${spec.duration_ms}ms)`);
  }

  sceneFiles.push(cached);
}

await browser.close();

if (issues.length) {
  console.error('\nISSUES:');
  for (const i of issues) console.error(`  - ${i}`);
  console.error('\n검사가 실패했다. mp4를 만들지 않는다.');
  process.exit(1);
}

// --- concat + final encode -------------------------------------------------
function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`)),
    );
  });
}

const listPath = join(cacheDir, 'concat.txt');
await writeFile(listPath, sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

const silent = join(cacheDir, 'silent.mp4');
await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', silent]);

// Instagram has been known to reject an mp4 with no audio track at all, so a
// silent one goes in. "No sound" is not the same as "no audio stream".
const finalName = gate.internal ? 'reel_INTERNAL.mp4' : 'reel.mp4';
const finalPath = join(outDir, finalName);
await run('ffmpeg', [
  '-y',
  '-i', silent,
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-shortest',
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart',
  finalPath,
]);

await rm(silent, { force: true });

// The closing line reports the FILE, not the plan.
//
// It used to print plan.total_ms — the number the renderer was aiming at — so
// the one line an operator reads was structurally incapable of disagreeing with
// the plan. A run that shipped 22.03 seconds announced 22.5 and nobody could
// have known from the output. Every scene has been measured individually by
// this point; measuring the concatenated artifact costs one ffprobe and closes
// the gap between "what was asked for" and "what is on disk".
//
// A deviation here means concat or the audio mux dropped something the scenes
// had, which cannot be reported as an ISSUE (that gate has already closed) and
// must not be reported as a note either: a wrong-length mp4 with a publishable
// name is precisely what this script exists to not produce. So it fails, and
// takes the file with it.
const measured = await probeVideo(finalPath).catch((e) => ({ durationMs: null, error: e.message }));
if (measured.durationMs === null || Math.abs(measured.durationMs - plan.total_ms) > DURATION_TOLERANCE_MS) {
  await rm(finalPath, { force: true });
  console.error(
    `\n최종 mp4가 원장 길이와 다르다 — 원장 ${(plan.total_ms / 1000).toFixed(3)}초, ` +
      `실측 ${measured.durationMs === null ? `측정 실패(${measured.error ?? '알 수 없음'})` : `${(measured.durationMs / 1000).toFixed(3)}초`}. ` +
      '씬은 전부 검증을 통과했으므로 concat 또는 오디오 먹싱 단계의 문제다. 파일을 지웠다.',
  );
  process.exit(1);
}

console.log(
  `\n${plan.scenes.length} scene(s), ${(measured.durationMs / 1000).toFixed(2)}s 실측 -> ${finalPath}`,
);

if (notes.length) {
  console.log('\nNOTES (not failures):');
  for (const n of notes) console.log(`  · ${n}`);
}
