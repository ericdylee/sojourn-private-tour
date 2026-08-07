import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { assertFontsLoaded } from '../lib/fonts.mjs';

const CARDS = resolve(import.meta.dirname, '../../../../../_workspace/03_cards.html');
const REEL = resolve(import.meta.dirname, '../../../../../_workspace/04_reel.html');
const FONTS_CSS = resolve(import.meta.dirname, '../../assets/fonts/fonts.css');

async function missingOn(url, viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  await page.goto(url);
  const missing = await assertFontsLoaded(page);
  await browser.close();
  return missing;
}

test('현재 카드 세트에서 브랜드 폰트가 전부 로드된다', async () => {
  assert.deepEqual(await missingOn(pathToFileURL(CARDS).href, { width: 1080, height: 1080 }), []);
});

// 릴스는 여섯 굵기 중 넷만 쓴다 — 배지(Inter 700)가 없다. @font-face는 그
// 페이스를 실제로 쓰는 요소가 있을 때만 로드되므로, load() 없이 check()만
// 하면 이 페이지는 "폰트 없음"으로 실패했다. 진짜 실패가 아닌데 실행이 막힌다.
test('릴스 페이지도 통과한다 — 페이지가 그 굵기를 쓰는지가 아니라 얻을 수 있는지를 묻는다', async () => {
  assert.deepEqual(await missingOn(pathToFileURL(REEL).href, { width: 1080, height: 1920 }), []);
});

test('브랜드 서체를 하나도 안 쓰는 페이지도 통과한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fonts-'));
  const html = join(dir, 'plain.html');
  await writeFile(
    html,
    `<!doctype html><meta charset="utf-8">` +
      `<link rel="stylesheet" href="${pathToFileURL(FONTS_CSS).href}">` +
      `<p style="font-family:monospace">nothing here uses the brand faces</p>`,
  );
  assert.deepEqual(await missingOn(pathToFileURL(html).href, { width: 400, height: 400 }), []);
});

// load()가 검사를 무디게 만들지 않는다는 증거. woff2가 없으면 load가 실패하고
// FontFace는 status "error"로 끝나므로 check도 그대로 false다. 이 테스트가
// 초록불이 되는 순간(= missing이 빈 배열이 되는 순간) 이 모듈은 아무것도
// 보증하지 않는 검사가 된다.
test('woff2가 없으면 여섯 종 전부 실패한다 — load()는 없는 폰트를 만들어내지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fonts-broken-'));
  const html = join(dir, 'broken.html');
  const faces = [
    ['Montserrat', 600], ['Montserrat', 700], ['Montserrat', 800],
    ['Inter', 400], ['Inter', 700], ['Inter', 900],
  ]
    .map(
      ([family, weight]) =>
        `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
        `src:url(missing-${family}-${weight}.woff2) format('woff2')}`,
    )
    .join('');
  await writeFile(
    html,
    `<!doctype html><meta charset="utf-8"><style>${faces}</style>` +
      `<p style="font:800 80px Montserrat">A</p><p style="font:400 24px Inter">B</p>`,
  );
  const missing = await missingOn(pathToFileURL(html).href, { width: 400, height: 400 });
  assert.equal(missing.length, 6, `여섯 종 전부 실패해야 한다 — 실제: ${JSON.stringify(missing)}`);
});
