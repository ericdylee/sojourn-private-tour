import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { mkdtemp, stat, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { seekTo, openEncoder, captureScene, verifySceneVideo, FPS } from '../lib/reel-capture.mjs';

const exists = async (p) => access(p).then(() => true, () => false);

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

// --- 중단된 실행이 캐시 키에 남기지 않는다 --------------------------------
//
// 이 파일이 막는 실제 사고: ffmpeg은 SIGINT를 받으면 출력 파일을 버리는 게
// 아니라 **마무리한다.** 그래서 냉시작 렌더 중 Ctrl-C — 4분짜리 작업을 멈추는
// 정상적인 방법 — 는 구조적으로 멀쩡하고 재생까지 되는 짧은 mp4를 남겼다.
// 호출자는 그 경로를 콘텐츠 해시 캐시 키로 쓰고 access()로만 확인하므로,
// 다음 실행이 그걸 "cache hit"으로 받아들였다. 실측: 씬 04에서 중단하자
// 4.5초 자리에 4.033초(121프레임)가 남았고, 재실행은 `scene 04: cache hit
// (4500ms)`를 찍고 exit 0으로 22.03초짜리 릴스를 내놓으면서 요약 줄에는
// 22.5초라고 적었다.
//
// 고친 방향: 인코더는 `<key>.mp4.part`에 쓰고 ffmpeg이 0으로 끝난 뒤에만
// rename한다. 중단된 실행은 키 자리에 아무것도 남기지 않는다.

test('최종 경로는 close()가 끝나기 전까지 존재하지 않는다', async () => {
  const { browser, page, el } = await openScene();
  const dir = await mkdtemp(join(tmpdir(), 'reel-part-'));
  const out = join(dir, 'scene.mp4');

  const enc = openEncoder(out, { fps: FPS, width: 1080, height: 1920 });
  assert.equal(enc.partPath, `${out}.part`, '인코더가 .part에 써야 한다');

  await captureScene({ page, el, durationMs: 300, fps: FPS, onFrame: enc.write });
  await browser.close();

  // 여기가 중단 지점이다. 프레임은 이미 인코더에 들어갔지만 close()는 아직
  // 부르지 않았다 — 이 상태에서 프로세스가 죽으면 키 자리는 비어 있어야 한다.
  //
  // .part가 이 시점에 이미 있는지는 단정하지 않는다. ffmpeg이 파이프를 언제
  // 소비하기 시작하는지에 달린 경합이고(작은 프레임 몇 장은 파이프 버퍼에
  // 그대로 들어앉는다), 이 테스트가 지키는 성질이 아니다. 지키는 성질은
  // "키 자리에 아무것도 없다" 하나다.
  assert.equal(await exists(out), false, '최종 경로(=캐시 키)가 close() 전에 이미 존재한다');

  await enc.close();

  assert.equal(await exists(out), true, 'close() 후에는 최종 경로가 있어야 한다');
  assert.equal(await exists(enc.partPath), false, '.part가 남았다 — rename이 아니라 복사였나');

  await rm(dir, { recursive: true, force: true });
});

// --- 캐시 히트는 측정으로 확인한다 ----------------------------------------
//
// .part 처리는 앞으로 생길 잘린 항목을 막을 뿐, 이미 키 자리에 앉아 있는
// 것은 못 치운다. verifySceneVideo가 그 몫이다.

async function makeClip(path, seconds) {
  await execFileAsync('ffmpeg', [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=black:s=320x568:r=30`,
    '-frames:v', String(Math.round(seconds * 30)),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast',
    path,
  ]);
}

test('길이가 맞는 씬 파일은 통과한다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reel-verify-'));
  const good = join(dir, 'good.mp4');
  await makeClip(good, 4.5);
  assert.deepEqual(await verifySceneVideo(good, { durationMs: 4500, fps: 30 }), []);
  await rm(dir, { recursive: true, force: true });
});

test('중단으로 잘린 씬 파일을 잡는다 — 재생은 되지만 짧다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reel-verify-'));
  const short = join(dir, 'short.mp4');
  // 실제 중단 실측값과 같은 모양: 135프레임 자리에 121프레임.
  await makeClip(short, 121 / 30);

  const complaints = await verifySceneVideo(short, { durationMs: 4500, fps: 30 });
  assert.ok(complaints.length > 0, '잘린 파일을 잡아야 한다');
  assert.ok(
    complaints.some((c) => /프레임 121장 — 135장/.test(c)),
    `프레임 수를 밝혀야 한다 — ${JSON.stringify(complaints)}`,
  );
  await rm(dir, { recursive: true, force: true });
});

test('mp4가 아닌 쓰레기는 크래시가 아니라 불만 한 줄이 된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reel-verify-'));
  const junk = join(dir, 'junk.mp4');
  await (await import('node:fs/promises')).writeFile(junk, 'not an mp4');
  const complaints = await verifySceneVideo(junk, { durationMs: 4500, fps: 30 });
  assert.ok(complaints.length > 0, '깨진 파일을 잡아야 한다');
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
