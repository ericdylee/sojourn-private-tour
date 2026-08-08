import { spawn, execFile } from 'node:child_process';
import { rename, rm } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const FPS = 30;

/* Two frames at 30fps. A complete scene lands on its expected duration exactly
 * (135 frames at 30fps probes as 4.500000s), so this is slack for container
 * rounding, not a budget for missing frames — the frame count is checked
 * separately and exactly. */
export const DURATION_TOLERANCE_MS = 67;

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
 * Reads back what was actually encoded.
 *
 * Nothing in this pipeline used to measure its own output — the renderer's
 * closing line printed the PLAN's total, so a reel that was half a second
 * short still announced itself as 22.5s. `nb_frames` is present on the mp4s
 * this encoder writes, so the frame count can be compared exactly rather than
 * inferred from a duration.
 */
export async function probeVideo(path) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_frames,r_frame_rate,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    path,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0] ?? {};
  const frames = Number.parseInt(stream.nb_frames ?? '', 10);
  const seconds = Number.parseFloat(parsed.format?.duration ?? '');
  return {
    frames: Number.isFinite(frames) ? frames : null,
    durationMs: Number.isFinite(seconds) ? Math.round(seconds * 1000) : null,
    frameRate: stream.r_frame_rate ?? null,
    codec: stream.codec_name ?? null,
  };
}

/**
 * Is the file at `path` actually the scene it claims to be? Returns a list of
 * complaints; empty means it matches.
 *
 * WHY this exists: ffmpeg traps SIGINT and *finalises* its output, so Ctrl-C
 * during a cold render — the normal way anyone stops a four-minute job —
 * leaves a structurally valid, playable, SHORT mp4 behind. Reproduced: an
 * interrupt partway through scene 04 left a 4.033s / 121-frame file where a
 * 4.5s / 135-frame one belonged, and the next run reported
 * `scene 04: cache hit (4500ms)` and shipped it. `access()` cannot tell those
 * apart. Measuring can.
 */
export async function verifySceneVideo(path, { durationMs, fps = FPS }) {
  const expectedFrames = Math.round((durationMs / 1000) * fps);
  let probe;
  try {
    probe = await probeVideo(path);
  } catch (e) {
    return [`ffprobe로 읽히지 않는다 — ${String(e.message).split('\n')[0]}`];
  }

  const out = [];
  if (probe.frames === null) {
    out.push('프레임 수를 읽을 수 없다 (비디오 스트림이 없거나 손상됐다)');
  } else if (probe.frames !== expectedFrames) {
    out.push(`프레임 ${probe.frames}장 — ${expectedFrames}장이어야 한다`);
  }

  if (probe.durationMs === null) {
    out.push('길이를 읽을 수 없다');
  } else if (Math.abs(probe.durationMs - durationMs) > DURATION_TOLERANCE_MS) {
    out.push(`길이 ${(probe.durationMs / 1000).toFixed(3)}초 — ${(durationMs / 1000).toFixed(3)}초여야 한다`);
  }

  return out;
}

/**
 * Starts ffmpeg reading PNG frames from stdin.
 *
 * Frames never touch disk: a 1080x1920 PNG is 2-3MB and a full reel is ~450 of
 * them. Piping keeps peak temp usage at one frame.
 *
 * The encoder writes to `<outPath>.part` and renames only after ffmpeg exits 0.
 * WHY: the caller uses outPath as a content-addressed cache key, and ffmpeg
 * finalises its output on SIGINT rather than abandoning it — so writing
 * straight to the key meant an interrupted run left a complete-looking, short
 * mp4 at a legitimate key that every later run accepted as a hit. A rename is
 * atomic within a filesystem, so the key either does not exist or holds a file
 * ffmpeg finished. An interrupted run leaves a `.part`, which is not a key and
 * gets overwritten by the next attempt (`-y`).
 */
export function openEncoder(outPath, { fps = FPS, width = 1080, height = 1920 } = {}) {
  const partPath = `${outPath}.part`;
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
      // Stated, not inferred. ffmpeg picks the muxer from the output file's
      // extension, and the extension is now `.part` — which it does not
      // recognise ("Unable to choose an output format ... use a standard
      // extension or specify the format manually", exit 234). Naming the
      // format also stops the container from ever depending on what the cache
      // key happens to be called.
      '-f', 'mp4',
      partPath,
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
    /* The file ffmpeg is actually writing. Exposed so a caller (or a test) can
     * assert that nothing appears at the real path until close() resolves. */
    partPath,

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
      try {
        await done;
      } catch (e) {
        /* A partial file whose encoder reported failure is worth nothing and
         * only invites someone to wonder what it is. The rejection still
         * propagates — the cleanup is not a recovery. */
        await rm(partPath, { force: true });
        throw e;
      }
      await rename(partPath, outPath);
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
