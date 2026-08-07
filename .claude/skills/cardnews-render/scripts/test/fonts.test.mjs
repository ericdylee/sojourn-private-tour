import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { assertFontsLoaded } from '../lib/fonts.mjs';

const CARDS = resolve(import.meta.dirname, '../../../../../_workspace/03_cards.html');

test('현재 카드 세트에서 브랜드 폰트가 전부 로드된다', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
  await page.goto(pathToFileURL(CARDS).href);
  const missing = await assertFontsLoaded(page);
  await browser.close();
  assert.deepEqual(missing, []);
});
