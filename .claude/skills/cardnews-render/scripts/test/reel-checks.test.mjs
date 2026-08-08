import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  checkSafeArea,
  checkWordCount,
  checkTextTransform,
  checkSingleLine,
  checkPlanPhoto,
} from '../lib/reel-checks.mjs';

async function scene(file) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(import.meta.dirname, 'fixtures', file)).href);
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('section.reel-scene');
  return { browser, page, el };
}

test('정상 씬은 세이프에어리어를 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkSafeArea(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('하단 400px 안의 요소를 잡는다', async () => {
  const { browser, el } = await scene('scene-unsafe.html');
  const issues = await checkSafeArea(el, { label: 'scene 01' });
  await browser.close();
  assert.ok(issues.length > 0, '하단 밴드 침범을 잡아야 한다');
  assert.match(issues[0], /SAFE AREA/);
});

test('정상 씬은 단어 수를 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('헤드라인 7단어를 잡는다', async () => {
  const { browser, el } = await scene('scene-wordy.html');
  const issues = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.ok(issues.length > 0, '7단어 헤드라인을 잡아야 한다');
  assert.match(issues[0], /WORDS/);
});

test('헤드라인이 아예 없는 씬을 잡는다', async () => {
  const { browser, el } = await scene('scene-no-headline.html');
  const issues = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.ok(issues.length > 0, '.display가 없으면 잡아야 한다');
  assert.match(issues[0], /HEADLINE/);
});

// --- 대문자 누수 ---------------------------------------------------------
//
// reel.css의 `.reel-scene .display { text-transform: none }`은 기본값이 아니라
// brand.css:109-111(카드용 Anton 시절 대문자 규칙)을 되돌리는 리셋이다. 그 줄이
// 지워져도 다른 검사는 전부 조용하다 — 대문자는 합법적인 레이아웃이라 막히는
// 게 아니라 틀린 채로 나간다. 아래 두 테스트가 그 침묵을 메운다.

test('정상 씬은 text-transform 검사를 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkTextTransform(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('리셋이 지워져 .display가 대문자로 계산되면 잡는다', async () => {
  const { browser, el } = await scene('scene-uppercase.html');
  const issues = await checkTextTransform(el, { label: 'scene 01' });
  await browser.close();
  assert.equal(issues.length, 1, `대문자 누수를 잡아야 한다 — 실제: ${JSON.stringify(issues)}`);
  assert.match(issues[0], /TYPE — \.display is text-transform:uppercase/);
  // 사유가 메시지 안에 있어야 한다. "무엇"만 말하면 다음 사람이 리셋을 다시
  // 지운다 — 왜 그 줄이 거기 있는지가 코드가 아니라 출력에 남아야 한다.
  assert.match(issues[0], /verbatim/);
});

test('같은 씬을 다른 검사에 걸면 아무도 못 잡는다 — 이 검사가 메우는 침묵', async () => {
  // 이 테스트가 빨간불이 되면(= 다른 검사가 대문자를 잡기 시작하면)
  // checkTextTransform은 중복이다. 그때까지는 유일한 방어선이다.
  const { browser, el } = await scene('scene-uppercase.html');
  const safe = await checkSafeArea(el, { label: 'scene 01' });
  const words = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(safe, [], '세이프에어리어는 대문자를 못 본다');
  assert.deepEqual(words, [], '단어 수는 대문자를 못 본다');
});

// --- 줄바꿈(한 줄이어야 하는 요소) --------------------------------------
//
// lib/contrast.mjs의 APPEARANCE.singleLine은 카드 전용 선택자 5종(.cta-band
// .url 등)이고, render-cards.mjs만 그걸 쓴다. 릴스는 그 선택자를 하나도
// 그리지 않으므로 그대로 가져오면 "항상 아무것도 못 찾는 검사"가 된다.
// 릴스에서 한 줄이 전제인 것은 `.sub strong` 안의 URL 하나뿐이다.

test('URL이 한 줄에 들어가면 아무 말도 하지 않는다', async () => {
  const { browser, el } = await scene('scene-url-ok.html');
  const issues = await checkSingleLine(el, { label: 'scene 05' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('URL이 두 줄로 접히면 잡는다', async () => {
  const { browser, el } = await scene('scene-longurl.html');
  const issues = await checkSingleLine(el, { label: 'scene 05' });
  await browser.close();
  assert.equal(issues.length, 1, `접힌 URL을 잡아야 한다 — 실제: ${JSON.stringify(issues)}`);
  assert.match(issues[0], /LINES — strong wrapped onto 2 lines/);
  assert.match(issues[0], /sojournkorea/, `어떤 문자열이 접혔는지 말해야 한다 — ${issues[0]}`);
});

test('접힌 URL을 다른 검사에 걸면 아무도 못 잡는다 — 이 검사가 메우는 침묵', async () => {
  // scene-longurl.html은 세이프에어리어·단어 수·대문자 어디에도 걸리지 않는다.
  // 이 테스트가 빨간불이 되면 checkSingleLine은 중복이다. 그때까지는 유일하다.
  const { browser, el } = await scene('scene-longurl.html');
  const safe = await checkSafeArea(el, { label: 'scene 05' });
  const words = await checkWordCount(el, { label: 'scene 05' });
  const caps = await checkTextTransform(el, { label: 'scene 05' });
  await browser.close();
  assert.deepEqual(safe, [], '세이프에어리어는 접힌 URL을 못 본다');
  assert.deepEqual(words, [], '단어 수는 헤드라인만 센다');
  assert.deepEqual(caps, [], 'text-transform은 접힌 URL을 못 본다');
});

// --- 원장 ↔ HTML 사진 대조 ----------------------------------------------
//
// 발행 게이트는 04_reel_plan.json의 photo로 라이선스를 판정하고, 프레임에
// 찍히는 것은 HTML의 <img>다. 둘을 맞춰 보는 코드가 없어서, 게이트가
// CC BY 4.0을 통과시키는 동안 CC BY-SA 2.0 사진이 전 프레임에 들어가고도
// 이슈 0건·발행 가능 판정이 나왔다(실제 재현됨).
//
// 대조 대상은 둘이다. data-photo는 원장 키(장부)이고 src는 실제로 받아오는
// 파일(픽셀)이다. 처음 판은 data-photo만 봤고, 그래서 src만 옮기면 구멍이
// 그대로 열려 있었다 — 아래 두 번째 블록이 그 경우다.

const PHOTOS_ROOT = resolve(import.meta.dirname, '../../../../../assets/photos');

test('원장과 HTML이 같은 사진을 가리키면 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: 'place/gamcheon-sky-vista.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('원장과 HTML의 data-photo가 다르면 잡는다 — 게이트가 검사한 파일과 찍힌 파일이 다르다', async () => {
  // 매니페스트에 실재하는 고아 행. 이름이 한 글자 차이라 오타 거리다.
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: 'place/gamcheon-hero-src.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.ok(issues.length > 0, `불일치를 잡아야 한다 — 실제: ${JSON.stringify(issues)}`);
  assert.match(issues[0], /원장과 HTML이 다른 사진을 가리킨다/);
  assert.match(issues[0], /gamcheon-hero-src\.jpg/, `원장 쪽 파일명을 밝혀야 한다 — ${issues[0]}`);
  assert.match(issues[0], /gamcheon-sky-vista\.jpg/, `HTML 쪽 파일명을 밝혀야 한다 — ${issues[0]}`);
});

// 최종 리뷰가 end-to-end로 재현한 그 경우다. src만 고아 SA 파일로 옮기고
// data-photo와 원장은 일치시키면, 수정 전에는 exit 0 · ISSUES 0 · 발행 가능한
// 13.5MB reel.mp4가 나왔고 전 프레임이 SA 사진이었다. 화면의 크레딧은 원장
// 쪽 저작자·라이선스를 그대로 적고 있었으니, 잘못된 표시까지 동반한다.
test('data-photo가 원장과 같아도 src가 다른 파일이면 잡는다 — 픽셀은 src에서 온다', async () => {
  const { browser, el } = await scene('scene-photo-src-drift.html');
  // 픽셀이 실제로 SA 파일에서 오고 있다는 것을 먼저 고정한다. 이게 깨지면
  // 아래 단정은 검사를 시험하는 게 아니라 픽스처를 시험하는 것이 된다.
  const painted = await el.evaluate((n) => {
    const img = n.querySelector('img');
    return { file: img.currentSrc.split('/').pop(), w: img.naturalWidth };
  });
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: 'place/gamcheon-sky-vista.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.equal(painted.file, 'gamcheon-hero-src.jpg');
  assert.ok(painted.w > 0, '픽스처의 사진이 실제로 로드돼야 한다');
  assert.equal(issues.length, 1, `src 불일치를 잡아야 한다 — 실제: ${JSON.stringify(issues)}`);
  assert.match(issues[0], /원장과 실제로 찍히는 파일이 다르다/);
  assert.match(issues[0], /gamcheon-hero-src\.jpg/, `찍히는 파일을 밝혀야 한다 — ${issues[0]}`);
});

// 반대 방향. 같은 파일을 다르게 적었을 뿐인데 실패하면, 이 검사는 다음번에
// 우회 대상이 된다. `./` · `dir/..` · 이중 슬래시 · 퍼센트 이스케이프를 한
// 픽스처에 모아 뒀다.
test('철자만 다르고 같은 파일이면 통과한다 — ./ 와 dir/.. 로 거짓 실패를 내지 않는다', async () => {
  const { browser, el } = await scene('scene-photo-src-spelling.html');
  const painted = await el.evaluate((n) => n.querySelector('img').naturalWidth);
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: 'place/gamcheon-sky-vista.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.ok(painted > 0, '픽스처의 별난 철자가 실제로 같은 파일을 받아와야 한다');
  assert.deepEqual(issues, [], `같은 파일이므로 통과해야 한다 — ${JSON.stringify(issues)}`);
});

// 원장 쪽도 같은 정규화를 거친다. 원장이 `./place/x.jpg`로 적혀 있어도
// `place/x.jpg`와 같은 파일이다.
test('원장 쪽 철자가 ./로 시작해도 같은 파일로 읽는다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: './place/gamcheon-sky-vista.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.deepEqual(issues, [], JSON.stringify(issues));
});

test('원장이 사진을 지정했는데 HTML에 <img>가 없으면 잡는다', async () => {
  const { browser, el } = await scene('scene-no-headline.html');
  const issues = await checkPlanPhoto(el, {
    label: 'scene 01',
    planPhoto: 'place/gamcheon-sky-vista.jpg',
    photosRoot: PHOTOS_ROOT,
  });
  await browser.close();
  assert.equal(issues.length, 1, JSON.stringify(issues));
  assert.match(issues[0], /HTML에 <img>가 없다/);
});

test('checkPhotos는 이 불일치를 못 본다 — 라이선스 규칙도 src 규칙도 거기 없다', async () => {
  // checkPhotos는 매니페스트 등재·슬롯·AI생성·크레딧만 보고, 전부 data-photo
  // 기준이다. 원장이 무엇을 가리키는지는 인자로 받지도 않고, src가 다른 파일을
  // 가리켜도 볼 규칙이 없다. 그래서 이 검사가 따로 필요하다 — SA 사진이 전
  // 프레임에 들어간 그 픽스처를 그대로 먹여도 아무 불만이 없다.
  const { loadPhotoIndex, checkPhotos } = await import('../lib/photos.mjs');
  const { browser, el } = await scene('scene-photo-src-drift.html');
  const { photoIndex, manifestPath } = await loadPhotoIndex(
    resolve(import.meta.dirname, '../../../../../assets/photos/manifest.json'),
  );
  const issues = await checkPhotos(el, { photoIndex, manifestPath, label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, [], `checkPhotos는 이 씬에 아무 불만이 없다 — ${JSON.stringify(issues)}`);
});

import { checkContrastOverTime } from '../lib/reel-checks.mjs';

test('씬 중간만 보면 통과하지만 끝에서 무너지는 대비를 잡는다', async () => {
  const { browser, page, el } = await scene('scene-drift.html');
  const { issues } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 3000 });
  await browser.close();
  assert.ok(
    issues.some((i) => /CONTRAST/.test(i)),
    `끝 프레임의 흰 글자 on 흰 배경을 잡아야 한다 — ${JSON.stringify(issues)}`,
  );
});

test('정상 씬은 3프레임 전부 통과한다', async () => {
  const { browser, page, el } = await scene('scenes-ok.html');
  const { issues } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 3000 });
  await browser.close();
  assert.deepEqual(issues, []);
});

// 리뷰 회귀 테스트 — CRITICAL: settledStart()가 document.getAnimations()로
// "시작" 표본을 유도하면, 진짜 지연이 긴 진입 라인(reel.css의 .delay-1과 같은
// 관용구, 더 느릴 뿐) 하나만으로도 표본이 결함 구간을 지나쳐 0건을 보고했다.
// 고정 상수(ENTRANCE_MS)는 다른 요소의 타이밍을 보지 않으므로 같은 방식으로
// 속지 않는다.
test('진입 지연이 긴 두 번째 줄이 있어도 씬 시작부(0~560ms)의 대비 붕괴를 잡는다', async () => {
  const { browser, page, el } = await scene('scene-drift-stagger.html');
  const { issues } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 4500 });
  await browser.close();
  assert.ok(
    issues.some((i) => /CONTRAST/.test(i)),
    `씬 시작부의 흰 글자 on 흰 배경(진입 지연에 가려졌던 구간)을 잡아야 한다 — ${JSON.stringify(issues)}`,
  );
});

// 리뷰 회귀 테스트 — IMPORTANT 1·2: 배경이 씬 내내 움직이면 같은 결함이라도
// 표본마다 `worst X:1`과 면적 비율이 달라진다. 타임스탬프만 지우는 키는 이걸
// 못 묶어서 결함 1개가 issue 3개로, note는 아예 중복 제거 없이 3개로 남았다.
// 고쳐진 구현은 issue 1개(최악값 1.06:1 유지)·note 1개(최악값 2.10:1 유지)여야
// 한다.
test('배경이 씬 내내 움직여도 같은 요소의 결함은 issue 1개·note 1개로 묶인다', async () => {
  const { browser, page, el } = await scene('scene-drift-multi.html');
  const { issues, notes } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 3000 });
  await browser.close();
  assert.equal(issues.length, 1, `묶이지 않은 issue — ${JSON.stringify(issues)}`);
  assert.match(issues[0], /worst 1\.06:1/, `최악값(가장 낮은 비율)이 아니라 다른 표본이 남았다 — ${issues[0]}`);
  assert.equal(notes.length, 1, `묶이지 않은 note — ${JSON.stringify(notes)}`);
  assert.match(notes[0], /worst 2\.10:1/, `최악값(가장 낮은 비율)이 아니라 다른 표본이 남았다 — ${notes[0]}`);
});
