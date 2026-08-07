import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtemp, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seekTo, openEncoder, captureScene, FPS } from '../lib/reel-capture.mjs';

const execFileAsync = promisify(execFile);
const FIXTURE = resolve(import.meta.dirname, 'fixtures/skeleton.html');

// Decodes the actual video stream with ffprobe rather than trusting our own
// frame counter or a byte-size floor — a corrupt file that happens to clear
// 1000 bytes would pass a size check silently but fail this.
async function probeVideo(path) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate',
    '-of', 'json',
    path,
  ]);
  return JSON.parse(stdout).streams[0];
}

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

  const probe = await probeVideo(out);
  assert.equal(probe.codec_name, 'h264', `코덱이 h264가 아니다 — 실제 ${probe.codec_name}`);
  assert.equal(probe.width, 1080, `너비가 다르다 — 실제 ${probe.width}`);
  assert.equal(probe.height, 1920, `높이가 다르다 — 실제 ${probe.height}`);
  assert.equal(probe.r_frame_rate, '30/1', `프레임레이트가 다르다 — 실제 ${probe.r_frame_rate}`);

  await rm(dir, { recursive: true, force: true });
});

test('ffmpeg가 중간에 죽으면 write()가 멈추지 않고 reject한다', { timeout: 15_000 }, async () => {
  // Reproduces the crash/hang by hand before this test existed: a burst of
  // large writes fired without awaiting each one forces genuine backpressure
  // (many concurrent drain waits) before ffmpeg has finished dying, so at
  // least one write() is caught inside its drain wait at the moment of
  // death — the exact path that used to hang forever (or, with no listener
  // on stdin's own 'error', crash the process outright on EPIPE). A single
  // small write reliably resolves before ffmpeg dies, because ffmpeg reads
  // eagerly; only a payload large enough to outrun that eager read exposes
  // the bug, which is why this uses padded ~3MB frames instead of the tiny
  // fixture screenshots the other tests use.
  const { browser, page, el } = await openScene();
  const real = await el.screenshot();
  await browser.close();
  const frame = Buffer.concat([real, Buffer.alloc(3 * 1024 * 1024 - real.length, 0)]);

  const dir = await mkdtemp(join(tmpdir(), 'reel-dead-'));
  // The parent directory does not exist, so ffmpeg starts, detects the
  // input stream from the first valid PNG, then dies trying to open the
  // output and exits non-zero.
  const out = join(dir, 'missing-subdir', 'scene.mp4');
  const enc = openEncoder(out, { fps: FPS, width: 1080, height: 1920 });

  const writes = [];
  for (let i = 0; i < 20; i += 1) writes.push(enc.write(frame));

  await assert.rejects(
    Promise.all(writes),
    /ffmpeg exited/,
    'write()가 죽은 ffmpeg를 기다리며 멈췄다 — reject 대신 hang/crash',
  );

  await rm(dir, { recursive: true, force: true });
});
