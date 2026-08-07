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

  return {
    /* Honours backpressure: without the drain wait, a fast capture loop buys
     * unbounded memory in the stdin buffer. */
    async write(buf) {
      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
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
