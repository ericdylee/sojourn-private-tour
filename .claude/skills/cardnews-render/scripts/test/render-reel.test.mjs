import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';

const SCRIPTS = resolve(import.meta.dirname, '..');
const REPO = resolve(SCRIPTS, '../../../..');
const RENDERER = join(SCRIPTS, 'render-reel.mjs');
const REEL_HTML = join(REPO, '_workspace/04_reel.html');

/** Runs the renderer from the repo root (it resolves output/, assets/ and
 * _workspace/ relative to cwd) and hands back the exit code plus both streams
 * instead of throwing, because the case under test is a NON-zero exit. */
function runRenderer(args) {
  return new Promise((res) => {
    execFile(
      process.execPath,
      [RENDERER, ...args],
      { cwd: REPO, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => res({ code: err?.code ?? 0, stdout, stderr }),
    );
  });
}

/**
 * A failing run must not leave the OTHER filename behind.
 *
 * The removal used to sit next to the final encode, after the issues gate — so
 * it only ever ran on a successful render. Planting a reel.mp4 and then failing
 * a check produced: gate says INTERNAL, run says "mp4를 만들지 않는다", exit 1,
 * and the stale publishable reel.mp4 still sitting there as the newest-looking
 * artefact in output/reels/. That is the upload accident the gate exists to
 * prevent, reached through the failure door — which is the door runs actually
 * use.
 *
 * The plan here declares zero scenes, so loadReelPlan raises "씬이 0개다", the
 * per-scene loop never runs (no capture, no ffmpeg) and the script exits 1
 * within a browser launch. Fast, and it fails for a reason unrelated to the
 * filenames, which is the point: ANY failure has to clean up.
 */
test('검사가 실패해도 반대편 파일명은 지운다 (실패 문으로 들어와도 낡은 발행본이 안 남는다)', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'reels-out-'));
  const planPath = join(await mkdtemp(join(tmpdir(), 'reel-plan-')), 'plan.json');
  await writeFile(planPath, JSON.stringify({ campaign_id: 'stale-name-test', fps: 30, scenes: [] }));

  // Both names planted, so the assertion does not depend on today's QA verdict:
  // whichever one the gate declares illegitimate must be the one that is gone.
  await writeFile(join(outDir, 'reel.mp4'), 'stale publishable bytes');
  await writeFile(join(outDir, 'reel_INTERNAL.mp4'), 'stale internal bytes');

  const { code, stdout, stderr } = await runRenderer([REEL_HTML, planPath, outDir]);

  assert.equal(code, 1, `검사 실패는 exit 1이어야 한다 — stdout: ${stdout}\nstderr: ${stderr}`);
  assert.match(stderr, /mp4를 만들지 않는다/, stderr);

  const internal = /GATE: INTERNAL/.test(stdout);
  const doomed = internal ? 'reel.mp4' : 'reel_INTERNAL.mp4';
  const kept = internal ? 'reel_INTERNAL.mp4' : 'reel.mp4';
  const left = await readdir(outDir);

  assert.ok(!left.includes(doomed), `실패한 실행이 ${doomed}를 남겼다 — 남은 것: ${JSON.stringify(left)}`);
  // The other stale file is left alone on purpose: this run produced nothing,
  // so it is not the renderer's business to delete an artefact it did not
  // contradict. Only the name the verdict forbids goes.
  assert.ok(left.includes(kept), `판정과 같은 편 이름까지 지우면 안 된다 — 남은 것: ${JSON.stringify(left)}`);
});

/**
 * 원장이 디스크에 없는 사진을 가리키면 sceneKey가 그 파일을 읽다가 ENOENT를
 * 던진다. 안 잡으면 스택 트레이스로 프로세스가 끝나고, 루프가 끝난 뒤에야
 * 출력되는 ISSUES 목록 — checkPhotos가 이미 채워 둔 친절한 문장을 포함해서 —
 * 은 화면에 닿지 못한다. 판정 방향은 원래 안전했다(exit != 0, mp4 없음).
 * 고친 것은 운영자가 읽는 것이 문장이지 트레이스가 아니라는 점이다.
 */
test('없는 사진 파일은 크래시가 아니라 ISSUES 한 줄이 된다', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'reels-out-'));
  const planPath = join(await mkdtemp(join(tmpdir(), 'reel-plan-')), 'plan.json');
  await writeFile(
    planPath,
    JSON.stringify({
      campaign_id: 'missing-photo-test',
      fps: 30,
      scenes: [
        {
          n: 1,
          role: 'hook',
          headline: 'Even the easy way',
          support: 'x',
          photo: 'place/does-not-exist-on-disk.jpg',
          crop: '50% 50%',
          duration_ms: 2000,
        },
      ],
    }),
  );

  const { code, stdout, stderr } = await runRenderer([REEL_HTML, planPath, outDir]);

  assert.equal(code, 1, `stdout: ${stdout}\nstderr: ${stderr}`);
  assert.match(stderr, /ISSUES:/, stderr);
  assert.match(stderr, /CACHE — 씬 캐시 키를 만들 수 없다/, stderr);
  assert.doesNotMatch(stderr, /^\s*at .*render-reel\.mjs/m, `스택 트레이스가 남았다:\n${stderr}`);
  assert.deepEqual(await readdir(outDir), [], '실패한 실행은 산출물을 남기지 않는다');
});
