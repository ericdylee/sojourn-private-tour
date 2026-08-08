import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkSafeArea, checkWordCount, checkTextTransform } from '../lib/reel-checks.mjs';

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
