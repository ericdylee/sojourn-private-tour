import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { seekTo, openEncoder, captureScene, FPS } from '../lib/reel-capture.mjs';

const FIXTURE = resolve(import.meta.dirname, 'fixtures/skeleton.html');

async function openScene() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(FIXTURE).href);
  const el = await page.$('section.scene');
  return { browser, page, el };
}

// Reads the middle pixel of a PNG buffer by decoding it in the browser we
// already have open — no image dependency in scripts/.
async function middlePixel(page, buf) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, buf.toString('base64'));
}

test('seekTo가 시점을 실제로 감는다', async () => {
  const { browser, page, el } = await openScene();

  await seekTo(page, 0);
  const start = await middlePixel(page, await el.screenshot());

  await seekTo(page, 1000);
  const end = await middlePixel(page, await el.screenshot());

  await browser.close();

  assert.ok(start[0] < 20, `0ms는 검정이어야 한다 — 실제 ${start}`);
  assert.ok(end[0] > 235, `1000ms는 흰색이어야 한다 — 실제 ${end}`);
});

test('같은 시점을 두 번 찍으면 바이트가 같다', async () => {
  const { browser, page, el } = await openScene();

  await seekTo(page, 500);
  const a = await el.screenshot();
  await seekTo(page, 0);
  await seekTo(page, 500);
  const b = await el.screenshot();

  await browser.close();
  assert.ok(a.equals(b), '같은 시점의 프레임이 달랐다 — 결정론이 성립하지 않는다');
});

test('captureScene이 mp4를 만든다', async () => {
  const { browser, page, el } = await openScene();
  const dir = await mkdtemp(join(tmpdir(), 'reel-'));
  const out = join(dir, 'scene.mp4');

  const enc = openEncoder(out, { fps: FPS, width: 1080, height: 1920 });
  const n = await captureScene({ page, el, durationMs: 1000, fps: FPS, onFrame: enc.write });
  await enc.close();
  await browser.close();

  assert.equal(n, 30, '1초 30fps면 프레임 30장');
  const s = await stat(out);
  assert.ok(s.size > 1000, `mp4가 비었다 — ${s.size} bytes`);
  await rm(dir, { recursive: true, force: true });
});
