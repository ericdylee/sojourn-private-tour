import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkSafeArea, checkWordCount } from '../lib/reel-checks.mjs';

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
