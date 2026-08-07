import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneKey } from '../lib/reel-cache.mjs';

async function scaffold() {
  const dir = await mkdtemp(join(tmpdir(), 'cache-'));
  const css = join(dir, 'brand.css');
  const fonts = join(dir, 'fonts');
  const photo = join(dir, 'a.jpg');
  await writeFile(css, '.a{}');
  await mkdir(fonts);
  await writeFile(join(fonts, 'x.woff2'), 'FONT-A');
  await writeFile(photo, 'JPEG-A');
  return { dir, css, fonts, photo };
}

const base = (s) => ({
  sceneHtml: '<section>one</section>',
  cssPaths: [s.css],
  fontDir: s.fonts,
  photoPath: s.photo,
  durationMs: 3000,
  fps: 30,
  internal: false,
});

test('같은 입력은 같은 키를 낸다', async () => {
  const s = await scaffold();
  assert.equal(await sceneKey(base(s)), await sceneKey(base(s)));
});

test('씬 HTML이 바뀌면 키가 바뀐다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  const b = await sceneKey({ ...base(s), sceneHtml: '<section>two</section>' });
  assert.notEqual(a, b);
});

test('CSS가 바뀌면 키가 바뀐다 — 캐시가 거짓말하지 않는다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  await writeFile(s.css, '.a{color:red}');
  const b = await sceneKey(base(s));
  assert.notEqual(a, b, 'CSS를 고쳤는데 같은 키가 나오면 낡은 씬이 재사용된다');
});

test('폰트가 바뀌면 키가 바뀐다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  await writeFile(join(s.fonts, 'x.woff2'), 'FONT-B');
  const b = await sceneKey(base(s));
  assert.notEqual(a, b);
});

test('사진이 바뀌면 키가 바뀐다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  await writeFile(s.photo, 'JPEG-B');
  const b = await sceneKey(base(s));
  assert.notEqual(a, b);
});

test('INTERNAL 여부가 키에 들어간다 — 배너가 프레임에 굽히기 때문', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  const b = await sceneKey({ ...base(s), internal: true });
  assert.notEqual(a, b);
});

test('길이가 바뀌면 키가 바뀐다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  const b = await sceneKey({ ...base(s), durationMs: 3200 });
  assert.notEqual(a, b);
});
