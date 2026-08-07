import { spawn } from 'node:child_process';

export const FPS = 30;

/**
 * Seek every animation on the page to `tMs`.
 *
 * WHY not record in real time: a real-time recording is not reproducible and
 * cannot be interrogated. Pausing and setting currentTime makes "the frame at
 * 13.4s" an addressable thing, which is what the contrast check needs in order
 * to measure the start, middle and end of a scene.
 *
 * animation-fill-mode: both holds the end state past the duration, so seeking
 * beyond the end is well defined.
 */
export async function seekTo(page, tMs) {
  await page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, tMs);
}

/**
 * Starts ffmpeg reading PNG frames from stdin.
 *
 * Frames never touch disk: a 1080x1920 PNG is 2-3MB and a full reel is ~450 of
 * them. Piping keeps peak temp usage at one frame.
 */
export function openEncoder(outPath, { fps = FPS, width = 1080, height = 1920 } = {}) {
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-i', 'pipe:0',
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-pix_fmt', 'yuv420p',
      '-preset', 'medium',
      '-crf', '18',
      '-vf', `scale=${width}:${height}`,
      outPath,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );

  let stderr = '';
  ff.stderr.on('data', (d) => { stderr += d.toString(); });

  const done = new Promise((resolvePromise, reject) => {
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`ffmpeg exited ${code}\n${stderr.slice(-2000)}`));
    });
  });
  /* `done` rejects on any terminal ffmpeg failure, including one that
   * happens mid-stream, well before close() is ever called. A rejection
   * nobody has attached a handler to is an *unhandled* rejection, which
   * crashes the process under Node's default --unhandled-rejections=throw.
   * Attach one immediately so that stays true regardless of whether write()
   * ever needs to race against it below. */
  const settled = done.then(() => null, (err) => err);

  /* Without this, a write() to stdin after ffmpeg has already died (process
   * exited, its end of the pipe gone) emits an EPIPE 'error' event on
   * `ff.stdin` with zero listeners — Node's EventEmitter treats an
   * unlistened 'error' as fatal and throws, crashing the process outright.
   * Confirmed by hand: a burst of writes against a doomed ffmpeg (bad output
   * path) reliably crashed the process this way before this listener was
   * added. The listener itself is a no-op because the same failure is
   * already captured by `done` above via the process's 'close' event, which
   * is what write()/close() actually race against. */
  ff.stdin.on('error', () => {});
  /* Normal usage (captureScene) never has more than one write() in flight,
   * so at most one 'drain' listener at a time. A caller that fires several
   * writes without awaiting each one — as the mid-stream-death test does, on
   * purpose, to force real backpressure — can legitimately queue more than
   * Node's default 10-listener warning threshold; that is not a leak. */
  ff.stdin.setMaxListeners(0);

  return {
    /* Honours backpressure: without the drain wait, a fast capture loop buys
     * unbounded memory in the stdin buffer. Races the wait against `settled`
     * so a mid-stream ffmpeg death — which leaves stdin unable to ever fire
     * 'drain' again — surfaces as a rejection instead of hanging
     * captureScene forever. */
    async write(buf) {
      if (!ff.stdin.write(buf)) {
        const err = await Promise.race([
          new Promise((r) => ff.stdin.once('drain', () => r(null))),
          settled,
        ]);
        if (err) throw err;
      }
    },
    async close() {
      ff.stdin.end();
      await done;
    },
  };
}

export async function captureScene({ page, el, durationMs, fps = FPS, onFrame }) {
  const total = Math.round((durationMs / 1000) * fps);
  for (let i = 0; i < total; i += 1) {
    await seekTo(page, (i / fps) * 1000);
    await onFrame(await el.screenshot());
  }
  return total;
}
