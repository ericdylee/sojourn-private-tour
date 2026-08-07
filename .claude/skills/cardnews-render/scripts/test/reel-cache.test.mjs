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

test('fps가 바뀌면 키가 바뀐다', async () => {
  const s = await scaffold();
  const a = await sceneKey(base(s));
  const b = await sceneKey({ ...base(s), fps: 24 });
  assert.notEqual(a, b, 'fps가 해시에서 빠지면 다른 프레임률로 렌더한 씬이 낡은 캐시를 재사용한다');
});

test('css 경로 목록은 재조합될 수 없다 — 두 항목과, 그 둘을 이어붙인 한 항목이 같은 키를 내면 안 된다', async () => {
  // 리뷰어가 실제로 만든 충돌: 마커+경로+원본 바이트를 구분자 없이 이어붙이면
  // "두 개의 css 항목"과 "그 둘의 바이트가 우연히 이어붙은 한 개의 css 항목"이
  // 같은 바이트 스트림으로 무너진다. 길이 프리픽스(writeField)와 파일 내용의
  // sha256 다이제스트 치환이 이 재조합을 막는다 — 각 필드가 자기 길이를
  // 스스로 선언하므로 내용 안의 어떤 바이트열도 경계로 오독될 수 없다.
  const dir = await mkdtemp(join(tmpdir(), 'collide-'));
  const pathA = join(dir, 'a.css');
  const pathB = join(dir, 'b.css');
  const contentA = '.a{color:blue}';
  const contentB = '.b{color:green}';
  await writeFile(pathA, contentA);
  await writeFile(pathB, contentB);

  const shared = {
    sceneHtml: '<section>x</section>',
    durationMs: 1000,
    fps: 30,
    internal: false,
  };

  // 구성 A: 서로 다른 내용의 css 파일 두 개.
  const keyA = await sceneKey({ ...shared, cssPaths: [pathA, pathB] });

  // 구성 B: css 파일 한 개뿐이지만, 그 내용이 "contentA + 옛 구분자 + pathB
  // + contentB"다 — 옛 스킴이라면 A의 두 번째 css 항목과 바이트 단위로
  // 동일한 스트림을 재현한다.
  await writeFile(pathA, contentA + '\0css:' + pathB + contentB);
  const keyB = await sceneKey({ ...shared, cssPaths: [pathA] });

  assert.notEqual(
    keyA,
    keyB,
    '두 개의 css 항목과, 그 바이트를 이어붙인 한 개의 css 항목이 같은 키를 내면 다른 입력이 같은 캐시를 공유한다'
  );
});
