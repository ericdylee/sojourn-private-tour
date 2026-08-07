# 릴스 제작 자동화 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 카드뉴스의 HTML 원본에서 9:16 릴스를 다시 조판해, 크레딧 없이 검사 가능한 mp4를 뽑는 파이프라인을 만든다.

**Architecture:** 씬마다 독립적으로 렌더한다. Playwright가 CSS 애니메이션의 시점을 직접 감아(`getAnimations()`) 프레임을 꺼내고, 버퍼를 디스크에 쓰지 않고 ffmpeg stdin으로 흘려 씬 mp4를 만든다. 씬 mp4는 입력 전체(HTML·CSS·폰트·사진·길이·렌더러 버전)의 해시로 캐시되고, 최종 mp4는 concat으로 합친다. 발행 승인이 안 된 상태에서는 배너가 굽힌 `reel_INTERNAL.mp4`만 나온다.

**Tech Stack:** Node 26 · Playwright(chromium) · ffmpeg 8.1.1 · `node --test`

**설계 문서:** `docs/superpowers/specs/2026-08-07-reels-automation-design.md`

## Global Constraints

- **프로젝트 루트에 `package.json`을 만들지 마라.** 렌더 의존성은 `.claude/skills/cardnews-render/scripts/`에만 둔다 (`CLAUDE.md` CRITICAL 규칙 — 루트 `package.json`이 있으면 Stop 훅이 없는 `npm run lint/build/test`를 매 턴 실행해 실패한다)
- **부기 캐릭터를 산출물에 넣지 마라.** 2026-08-03 사용 보류 확정. 이 계획은 부기를 다루지 않는다
- **브리프 `facts` 원장에 없는 가격·소요시간·운영시간을 산출물에 쓰지 마라.** 이미지 속에 읽히는 값도 같은 주장이다 (ADR-013)
- **`_workspace/`를 지우지 마라.** 사후 검증과 부분 재실행의 근거다
- 프레임 규격: **1080×1920**, fps **30**
- 세이프에어리어: 상단 **200px** / 하단 **400px**
- 대비 임계: 실패 **2.0:1** · 경고 **3.0:1** · 면적 기준 **25%** (ADR-014 — 값을 바꾸지 마라)
- 씬 길이 공식: `0.4 + words × 0.28 + 0.5` 초, 하한 **2.0** · 상한 **4.5**
- 헤드라인 단어 수 상한: **6**
- 출력 규격: H.264 High · `yuv420p` · 30fps · CRF 18 · **무음 AAC 128k 트랙 포함**
- 테스트 실행: `cd .claude/skills/cardnews-render/scripts && node --test "test/*.test.mjs"`
- 모든 경로는 저장소 루트 기준. 렌더 명령은 저장소 루트에서 실행한다

---

## File Structure

| 파일 | 책임 |
|---|---|
| `.claude/skills/cardnews-render/assets/fonts/fonts.css` + `*.woff2` | 폰트를 로컬에 고정. 네트워크 의존 제거 |
| `.claude/skills/cardnews-render/assets/brand.css` (수정) | `@import` 한 줄을 로컬 폰트로 교체 |
| `.claude/skills/cardnews-render/assets/reel.css` | 9:16 조판 · 모션 어휘 3종 · 세이프에어리어 · INTERNAL 배너 |
| `scripts/lib/contrast.mjs` | 글자/배경 대비 실측 (render-cards.mjs에서 추출) |
| `scripts/lib/photos.mjs` | 사진 원장 대조 · AI 금지 · 크레딧 의무 (추출) |
| `scripts/lib/reel-capture.mjs` | 시점 seek · 프레임 캡처 · ffmpeg 파이프 |
| `scripts/lib/reel-plan.mjs` | 씬 계획 로딩 · 길이 계산 · 스키마 검증 |
| `scripts/lib/reel-checks.mjs` | 세이프에어리어 · 단어 수 · 3프레임 대비 오케스트레이션 |
| `scripts/lib/reel-gate.mjs` | QA 판정 + 사진 권리 → INTERNAL 여부 |
| `scripts/lib/reel-cache.mjs` | 씬 캐시 키 계산 |
| `scripts/render-reel.mjs` | 오케스트레이션 진입점 |
| `scripts/test/*.test.mjs` | 결함 재현 테스트 |

`scripts/lib/` 아래는 파일마다 한 가지 일만 한다. `render-cards.mjs`는 613줄 단일 스크립트인데, **추출하는 두 개 말고는 건드리지 않는다.**

---

## Task 1: 폰트를 로컬로 내린다

이 계획의 중심 장치(같은 HTML → 같은 프레임)가 성립하려면 먼저 이게 돼야 한다. `brand.css:5`가 Google Fonts를 `@import`하고 있어서, 네트워크가 실패하면 **대체 글꼴로 조용히 렌더된다** — `document.fonts.ready`는 그래도 resolve되므로 렌더러가 틀린 결과를 성공으로 보고한다.

**Files:**
- Create: `.claude/skills/cardnews-render/assets/fonts/fetch.sh`
- Create: `.claude/skills/cardnews-render/assets/fonts/fonts.css` (스크립트가 생성)
- Create: `.claude/skills/cardnews-render/assets/fonts/*.woff2` (스크립트가 생성)
- Modify: `.claude/skills/cardnews-render/assets/brand.css:5`
- Create: `.claude/skills/cardnews-render/scripts/lib/fonts.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/fonts.test.mjs`
- Modify: `.claude/skills/cardnews-render/scripts/package.json` (test 스크립트 추가)

**Interfaces:**
- Produces: `assertFontsLoaded(page) → Promise<string[]>` — 로드되지 않은 폰트 설명 배열. 빈 배열이면 정상

- [ ] **Step 1: 폰트 수집 스크립트를 쓴다**

`assets/fonts/fetch.sh`. Google Fonts는 UA에 따라 다른 포맷을 준다 — 최신 크롬 UA여야 woff2가 나온다. 영문 단독 캠페인이므로 `latin`과 `latin-ext` 서브셋만 받는다.

```bash
#!/usr/bin/env bash
# Vendors the brand webfonts into this directory.
#
# WHY: brand.css used to @import them from fonts.googleapis.com. A network
# failure then rendered every card in a fallback face while document.fonts.ready
# still resolved — the renderer reported success on a wrong result. Frame capture
# for reels makes that unacceptable, so the fonts are pinned here.
#
# Montserrat / Inter / Anton are all SIL OFL 1.1: vendoring and embedding are
# permitted. Licence texts sit next to the files.
#
# Re-run only to update the fonts. Output is committed.
set -euo pipefail
cd "$(dirname "$0")"

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
API='https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800;900&family=Montserrat:wght@600;700;800&display=swap'

raw=$(curl -sS -A "$UA" "$API")

# Keep only the latin and latin-ext blocks. The campaign is English-only; the
# cyrillic/greek/vietnamese subsets are dead weight in the cache key.
printf '%s\n' "$raw" | awk '
  /^\/\* / { keep = ($2 == "latin" || $2 == "latin-ext") }
  keep     { print }
' > fonts.css

grep -o 'https://[^)]*\.woff2' fonts.css | sort -u | while read -r url; do
  name=$(basename "$url")
  [ -f "$name" ] || curl -sS -o "$name" "$url"
  # Rewrite the remote URL to the local file, in place.
  sed -i '' "s#$url#$name#g" fonts.css
done

echo "vendored $(ls -1 *.woff2 | wc -l | tr -d ' ') woff2 files"
```

- [ ] **Step 2: 스크립트를 실행하고 결과를 확인한다**

```bash
chmod +x .claude/skills/cardnews-render/assets/fonts/fetch.sh
.claude/skills/cardnews-render/assets/fonts/fetch.sh
grep -c '@font-face' .claude/skills/cardnews-render/assets/fonts/fonts.css
grep -c 'https://' .claude/skills/cardnews-render/assets/fonts/fonts.css || echo "원격 URL 0개 — 정상"
```

기대: `@font-face` 블록 18개(Anton 1 + Inter 5 + Montserrat 3, 각 latin/latin-ext 2종), 원격 URL 0개.

- [ ] **Step 3: OFL 라이선스 파일을 받는다**

```bash
cd .claude/skills/cardnews-render/assets/fonts
curl -sS -o OFL-Montserrat.txt https://raw.githubusercontent.com/JulietaUla/Montserrat/master/OFL.txt
curl -sS -o OFL-Inter.txt       https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt
curl -sS -o OFL-Anton.txt       https://raw.githubusercontent.com/googlefonts/AntonFont/main/OFL.txt
```

- [ ] **Step 4: brand.css의 @import를 교체한다**

`brand.css:5`의 이 줄을

```css
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;700;800;900&family=Montserrat:wght@600;700;800&display=swap');
```

다음으로 바꾼다:

```css
/* Fonts are vendored, not fetched. A network failure used to render every card
 * in a fallback face while document.fonts.ready still resolved — the renderer
 * reported success on a wrong result. See assets/fonts/fetch.sh. */
@import url('./fonts/fonts.css');
```

- [ ] **Step 5: 폰트 로드 검사를 쓴다 (실패하는 테스트 먼저)**

`scripts/test/fonts.test.mjs`:

```js
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
```

- [ ] **Step 6: 실패를 확인한다**

`scripts/package.json`의 `scripts`에 다음을 추가한다:

```json
"test": "node --test \"test/*.test.mjs\""
```

```bash
cd .claude/skills/cardnews-render/scripts && npm test
```

기대: FAIL — `Cannot find module '../lib/fonts.mjs'`

- [ ] **Step 7: 최소 구현을 쓴다**

`scripts/lib/fonts.mjs`:

```js
/**
 * Positive assertion that the brand faces actually loaded.
 *
 * document.fonts.ready resolving is NOT evidence: it resolves once loading has
 * settled, including when every face failed and the page fell back. This checks
 * that the specific faces the brand system depends on are usable.
 */
const REQUIRED = [
  '800 80px Montserrat',
  '700 40px Montserrat',
  '600 32px Montserrat',
  '900 40px Inter',
  '700 28px Inter',
  '400 24px Inter',
];

export async function assertFontsLoaded(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(
    (specs) => specs.filter((s) => !document.fonts.check(s)),
    REQUIRED,
  );
}
```

- [ ] **Step 8: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && npm test
```

기대: PASS

- [ ] **Step 9: 폰트를 치우면 시끄럽게 실패하는지 확인한다**

이 단계의 목적은 "조용히 틀리지 않는 것"이므로, 그 실패가 실제로 드러나는지 봐야 한다.

```bash
cd .claude/skills/cardnews-render/assets/fonts && mkdir -p /tmp/fonts-bak && mv *.woff2 /tmp/fonts-bak/
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화/.claude/skills/cardnews-render/scripts && npm test; echo "exit=$?"
mv /tmp/fonts-bak/*.woff2 /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화/.claude/skills/cardnews-render/assets/fonts/
```

기대: 폰트가 없을 때 FAIL(exit 1), 되돌린 뒤 PASS.

- [ ] **Step 10: 카드 6장이 그대로인지 확인한다**

폰트 경로가 바뀌었으니 렌더 결과가 변하면 안 된다.

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
shasum -a 256 output/cards/*.png > /tmp/cards-before.txt
node .claude/skills/cardnews-render/scripts/render-cards.mjs _workspace/03_cards.html /tmp/cards-after
cd /tmp/cards-after && shasum -a 256 *.png | sed 's#\*\?##' > /tmp/cards-after.txt
diff <(awk '{print $1}' /tmp/cards-before.txt) <(awk '{print $1}' /tmp/cards-after.txt) && echo "6/6 동일"
```

기대: 6/6 동일. **다르면 여기서 멈춰라** — 로컬 폰트가 원격과 다른 버전이라는 뜻이고, 그건 이후 전부에 영향을 준다.

- [ ] **Step 11: 커밋**

```bash
git add .claude/skills/cardnews-render/assets/fonts/ \
        .claude/skills/cardnews-render/assets/brand.css \
        .claude/skills/cardnews-render/scripts/lib/fonts.mjs \
        .claude/skills/cardnews-render/scripts/test/fonts.test.mjs \
        .claude/skills/cardnews-render/scripts/package.json
git commit -m "fix(render): 폰트를 로컬로 고정한다 — 네트워크 실패 시 조용히 틀리던 것을 막는다

brand.css가 Google Fonts를 @import했다. 네트워크가 죽으면 대체 글꼴로
렌더되는데 document.fonts.ready는 그래도 resolve하므로 렌더러가 틀린
결과를 성공으로 보고했다. 카드는 사람이 한 장씩 봐서 견뎠지만 릴스는
프레임 수백 장이라 통하지 않는다.

assertFontsLoaded()는 fonts.ready가 아니라 필요한 face를 직접 확인한다.
폰트를 치운 상태에서 테스트가 실패하는 것까지 확인했다.
카드 6장 재렌더 sha256 6/6 동일."
```

---

## Task 2: 대비·사진 검사를 모듈로 뺀다

릴스가 이 두 검사를 쓴다. `render-cards.mjs`에 묻혀 있어 밖에서 못 쓴다. **딱 이 둘만 빼고 나머지 611줄은 건드리지 않는다.**

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/contrast.mjs`
- Create: `.claude/skills/cardnews-render/scripts/lib/photos.mjs`
- Modify: `.claude/skills/cardnews-render/scripts/render-cards.mjs` (해당 구간을 호출로 교체)

**Interfaces:**
- Produces: `APPEARANCE` — 대비 임계 상수 객체 (`{ singleLine, contrastFail: 2.0, contrastWarn: 3.0, badAreaShare: 0.25 }`)
- Produces: `checkContrast(page, el, { label, config }) → Promise<{ issues: string[], notes: string[] }>`
- Produces: `loadPhotoIndex(manifestPath) → Promise<{ photoIndex: Map<string, object>, manifestPath: string }>`
- Produces: `checkPhotos(el, { photoIndex, manifestPath, label }) → Promise<string[]>`

`label`은 메시지 앞에 붙는 식별자다 (카드는 `card 03`, 릴스는 `scene 02`).

- [ ] **Step 1: contrast.mjs를 만든다**

`render-cards.mjs`의 대비 구간(현재 305~499행)을 그대로 옮긴다. 바뀌는 것은 세 가지뿐이다 — 모듈 스코프 `failures`/`warnings`에 push하는 대신 배열을 반환하고, `card ${n}` 대신 `label`을 쓰고, `APPEARANCE`를 인자로 받는다.

```js
/**
 * Text/background contrast, measured against rendered pixels.
 *
 * Extracted from render-cards.mjs so the reel renderer can reuse it. The method
 * is unchanged: screenshot the frame once with every glyph turned transparent,
 * then read the real background out from under each piece of text. An ancestor
 * walk cannot do this — the card 02 pager vanished under a SIBLING that painted
 * over it, and no walk up the tree can see that plane.
 *
 * Thresholds are ADR-014 and are not accessibility thresholds. The job is to
 * catch text that is LOST, not to audit WCAG. Do not raise them without
 * revisiting that ADR.
 */
export const APPEARANCE = {
  singleLine: ['.cta-band .url', '.cta-band .go', '.pager', '.lockup .mark', '.lockup .handle'],
  contrastFail: 2.0,
  contrastWarn: 3.0,
  badAreaShare: 0.25,
};

export async function checkContrast(page, el, { label, config = APPEARANCE } = {}) {
  const issues = [];
  const notes = [];

  // ... (render-cards.mjs 309~498행의 본문을 그대로 옮긴다.
  //      `card` → `el`, `APPEARANCE` → `config`,
  //      `failures.push(\`card ${n}: X\`)` → `issues.push(\`${label}: X\`)`,
  //      `warnings.push(...)` → `notes.push(...)`)

  return { issues, notes };
}
```

- [ ] **Step 2: photos.mjs를 만든다**

`render-cards.mjs`의 사진 구간(현재 86~98행의 매니페스트 로딩 + 546~586행의 검사)을 옮긴다.

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Photo provenance. Images are held to the same standard as facts: nothing goes
 * into a deliverable unless its origin is on record (ADR-010, ADR-013).
 */
export async function loadPhotoIndex(manifestArg) {
  const manifestPath = resolve(manifestArg ?? 'assets/photos/manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    /* absent — handled per image */
  }
  return {
    manifestPath,
    photoIndex: new Map((manifest?.photos ?? []).map((p) => [p.file, p])),
  };
}

export async function checkPhotos(el, { photoIndex, manifestPath, label }) {
  const issues = [];

  const photos = await el.evaluate((node) =>
    [...node.querySelectorAll('.photo img')].map((img) => ({
      key: img.dataset.photo ?? null,
      slot: img.dataset.slot ?? null,
      src: img.getAttribute('src'),
      loaded: img.complete && img.naturalWidth > 0,
    })),
  );

  const hasCredit = await el.evaluate((node) => node.querySelectorAll('.photo-credit').length > 0);

  for (const p of photos) {
    const where = p.key ?? p.src ?? '(no src)';
    if (!p.loaded) issues.push(`${label}: PHOTO — ${where} failed to load`);
    if (!p.key || !p.slot) {
      issues.push(`${label}: PHOTO — ${where} is missing data-photo/data-slot`);
      continue;
    }
    const entry = photoIndex.get(p.key);
    if (!entry) {
      issues.push(`${label}: PHOTO — "${p.key}" is not in ${manifestPath}`);
      continue;
    }
    if (entry.slot !== p.slot) {
      issues.push(`${label}: PHOTO — "${p.key}" is slot "${entry.slot}" in the manifest, used as "${p.slot}"`);
    }
    if (p.slot === 'place' && entry.ai_generated) {
      issues.push(`${label}: PHOTO — "${p.key}" is AI-generated and cannot fill a place slot (ADR-010)`);
    }
    const rights = entry.rights ?? '';
    if (/^(unsplash|licensed:)/.test(rights) && !hasCredit) {
      issues.push(`${label}: PHOTO — "${p.key}" is ${rights} and needs a .photo-credit`);
    }
  }

  return issues;
}
```

- [ ] **Step 3: render-cards.mjs를 호출로 바꾼다**

상단 import에 추가:

```js
import { APPEARANCE, checkContrast } from './lib/contrast.mjs';
import { loadPhotoIndex, checkPhotos } from './lib/photos.mjs';
```

- 38~65행의 `const APPEARANCE = {...}` 정의를 지운다 (import가 대체한다)
- 86~98행의 매니페스트 로딩을 `const { photoIndex, manifestPath } = await loadPhotoIndex(manifestArg);`로 바꾼다
- 305~499행의 대비 구간을 다음으로 바꾼다:

```js
  {
    const { issues, notes } = await checkContrast(page, card, { label: `card ${n}` });
    failures.push(...issues);
    warnings.push(...notes);
  }
```

- 546~586행의 사진 구간을 다음으로 바꾼다:

```js
  failures.push(...(await checkPhotos(card, { photoIndex, manifestPath, label: `card ${n}` })));
```

- [ ] **Step 4: 카드가 바이트 단위로 같은지 확인한다 — 이 단계의 완료 조건**

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
node .claude/skills/cardnews-render/scripts/render-cards.mjs _workspace/03_cards.html /tmp/cards-lib
echo "exit=$?"
diff <(shasum -a 256 output/cards/*.png | awk '{print $1}') \
     <(shasum -a 256 /tmp/cards-lib/*.png | awk '{print $1}') && echo "6/6 동일"
```

기대: exit 0, 6/6 동일. **다르면 추출에서 뭔가 바뀐 것이다. 릴스로 넘어가지 마라.**

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/contrast.mjs \
        .claude/skills/cardnews-render/scripts/lib/photos.mjs \
        .claude/skills/cardnews-render/scripts/render-cards.mjs
git commit -m "refactor(render): 대비·사진 검사를 lib/으로 뺀다 — 릴스가 같은 검사를 쓴다

동작을 바꾸지 않았다. 모듈 스코프 배열에 push하던 것을 반환으로 바꾸고
'card NN' 하드코딩을 label 인자로 열었을 뿐이다.

완료 조건으로 카드 6장 재렌더 sha256 6/6 동일을 확인했다."
```

---

## Task 3: 결정론적 캡처를 증명한다 (walking skeleton)

**이 계획에서 유일하게 안 해본 기술이다.** 뒤의 전부가 여기 얹히므로 최소 조각으로 먼저 세운다. 진짜 조판(reel.css)은 다음 태스크다 — 여기서는 인라인 픽스처로 캡처 자체만 증명한다.

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/reel-capture.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/fixtures/skeleton.html`
- Create: `.claude/skills/cardnews-render/scripts/test/capture.test.mjs`

**Interfaces:**
- Consumes: 없음
- Produces: `FPS = 30`
- Produces: `seekTo(page, tMs) → Promise<void>` — 페이지의 모든 애니메이션을 정지시키고 `tMs` 시점으로 감는다
- Produces: `openEncoder(outPath, { fps, width, height }) → { stdin, done }` — `done`은 ffmpeg 종료를 기다리는 Promise
- Produces: `captureScene({ page, el, durationMs, fps, onFrame }) → Promise<number>` — 찍은 프레임 수를 반환

- [ ] **Step 1: 픽스처를 만든다**

`test/fixtures/skeleton.html` — 배경이 검정에서 흰색으로 선형 변하는 1초짜리 씬. 시점마다 픽셀 값이 달라야 seek가 실제로 먹었는지 확인할 수 있다.

```html
<!doctype html>
<meta charset="utf-8">
<style>
  body { margin: 0; background: #444; }
  .scene { width: 1080px; height: 1920px; background: #000; animation: fade 1000ms linear both; }
  @keyframes fade { from { background: #000; } to { background: #fff; } }
</style>
<section class="scene"></section>
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/capture.test.mjs`:

```js
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
```

- [ ] **Step 3: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/capture.test.mjs
```

기대: FAIL — `Cannot find module '../lib/reel-capture.mjs'`

- [ ] **Step 4: 구현한다**

`scripts/lib/reel-capture.mjs`:

```js
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
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/capture.test.mjs
```

기대: 3 pass.

**여기서 실패하면 멈추고 보고하라.** 대안은 두 개다 — CDP `Animation.setPlaybackRate(0)`, 또는 모든 모션을 단일 커스텀 속성 `--t`의 `calc()` 함수로 표현하는 방식. 계획 전체가 이 태스크에 얹혀 있으므로 우회하지 말고 사람에게 알려라.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-capture.mjs \
        .claude/skills/cardnews-render/scripts/test/capture.test.mjs \
        .claude/skills/cardnews-render/scripts/test/fixtures/skeleton.html
git commit -m "feat(reel): 결정론적 프레임 캡처 — 시점을 감아서 꺼낸다

실시간 녹화가 아니라 getAnimations()로 시점을 지정해 찍는다. 같은 시점의
프레임이 바이트 단위로 같은 것을 테스트로 확인했다. 그래야 특정 시점을
지목해 검사할 수 있다.

프레임은 디스크에 쓰지 않고 ffmpeg stdin으로 흘린다 — 1080x1920 PNG가
장당 2~3MB라 릴스 한 편이 1GB를 넘는다. 파이프에 backpressure 처리를 넣었다."
```

---

## Task 4: 9:16 조판 시스템 (reel.css)

**Files:**
- Create: `.claude/skills/cardnews-render/assets/reel.css`
- Create: `.claude/skills/cardnews-render/scripts/test/fixtures/scenes-ok.html`

**Interfaces:**
- Produces: `.reel-scene` — 1080×1920 프레임
- Produces: 모션 클래스 `.m-kenburns` · `.m-type-in`
- Produces: `.reel-safe-top`(200px) · `.reel-safe-bottom`(400px) 개념 — 검사가 읽는 값은 CSS가 아니라 `reel-checks.mjs`의 상수다
- Produces: `.internal-banner` — INTERNAL 판정 시 `<body class="internal">`로 켜진다

- [ ] **Step 1: reel.css를 쓴다**

```css
/* ---------------------------------------------------------------------------
 * 9:16 reel system. Tokens come from brand.css — this file only adds the
 * vertical frame, the motion vocabulary and the safe areas.
 *
 * Why re-typeset instead of pasting the 1:1 card PNG into a 1080x1920 canvas:
 * the v4 cards are full-bleed photographs. Caging one between colour bands
 * throws away the thing that makes v4 v4. We own the HTML, so we re-crop.
 * ------------------------------------------------------------------------ */
@import url('./brand.css');

.reel-scene {
  position: relative;
  width: 1080px;
  height: 1920px;
  overflow: hidden;
  background: var(--ink);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  /* Bottom 400px is covered by Instagram's caption and buttons; top 200px by
   * the account row. Nothing that must be read goes there. The check in
   * reel-checks.mjs enforces this — these paddings only make the layout obey
   * it by default. */
  padding: 200px 72px 400px;
}

/* --- background photo ---------------------------------------------------- */
.reel-scene .photo-bg {
  position: absolute;
  inset: 0;
  z-index: 0;
}
.reel-scene .photo-bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* object-position is per scene — a 1:1 crop moved to 9:16 loses the left and
   * right of the frame, so which part survives is an editorial decision. It is
   * recorded in 04_reel_plan.json and confirmed by a human before capture. */
  object-position: var(--crop, 50% 50%);
}

/* Black scrim buys contrast for the type without a soft shadow, which the
 * brand system forbids. Same device as .lay-simple on the cards. */
.reel-scene .scrim {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.55) 0%,
    rgba(0, 0, 0, 0.15) 35%,
    rgba(0, 0, 0, 0.25) 60%,
    rgba(0, 0, 0, 0.75) 100%
  );
}

.reel-scene .type { position: relative; z-index: 2; }

/* --- type ---------------------------------------------------------------- */
.reel-scene .display {
  font-family: var(--voice);
  font-weight: 800;
  font-size: 96px;
  line-height: 1.04;
  letter-spacing: -0.02em;
  color: #fff;
  margin: 0 0 28px;
  max-width: 936px;
}
.reel-scene .display .accent { color: var(--orange); }

.reel-scene .sub {
  font-family: var(--voice);
  font-weight: 600;
  font-size: 40px;
  line-height: 1.3;
  color: #fff;
  margin: 0;
  max-width: 880px;
}

/* Credit sits ABOVE the bottom 400px band. On the cards it lives inside the
 * crop guard (QA m2) — the one element that satisfies the licence obligation
 * placed where the system says things may be cut. Not repeated here. */
.reel-scene .photo-credit {
  position: absolute;
  left: 72px;
  bottom: 420px;
  z-index: 2;
  font-family: var(--text);
  font-weight: 400;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
}

/* --- motion -------------------------------------------------------------- */
/* Deliberately three. Camera work is restrained: heavy motion makes the type
 * unreadable, and the type is the message. */
@keyframes kenburns { from { transform: scale(1); } to { transform: scale(1.08); } }
.m-kenburns img { animation: kenburns var(--dur, 3000ms) linear both; transform-origin: center; }

@keyframes typein { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
.m-type-in { animation: typein 400ms cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.m-type-in.delay-1 { animation-delay: 160ms; }

/* --- internal draft banner ----------------------------------------------- */
/* Burned into the frame, not drawn by ffmpeg: it belongs to the brand system
 * and needs no font dependency outside the browser. Turned on by
 * <body class="internal">, decided before capture by reel-gate.mjs. */
body.internal .reel-scene::after {
  content: 'INTERNAL DRAFT — NOT FOR PUBLICATION';
  position: absolute;
  z-index: 9;
  left: 0;
  right: 0;
  top: 96px;
  padding: 14px 0;
  background: #c0261f;
  color: #fff;
  font-family: var(--text);
  font-weight: 800;
  font-size: 28px;
  letter-spacing: 0.06em;
  text-align: center;
}
```

- [ ] **Step 2: 통과해야 하는 픽스처를 만든다**

`test/fixtures/scenes-ok.html` — 뒤의 검사 태스크들이 "정상"의 기준으로 쓴다. 사진은 원장에 있는 실제 파일을 참조한다.

**경로에 주의하라.** 픽스처는 `scripts/test/fixtures/`에 있다. 거기서 `assets/`까지는 3단계(`fixtures → test → scripts → cardnews-render`), 저장소 루트까지는 6단계다.

그리고 `.photo-bg`는 **반드시 `.photo` 클래스도 함께** 가져야 한다 — `checkPhotos`가 `.photo img`를 찾기 때문에, `.photo-bg`만 쓰면 사진 검사가 아무것도 못 보고 조용히 통과한다.

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="../../../assets/reel.css">
<style> body { margin: 0; background: #222; } </style>

<section class="reel-scene" style="--crop: 50% 45%; --dur: 3000ms">
  <div class="photo photo-bg m-kenburns">
    <img src="../../../../../../assets/photos/place/gamcheon-sky-vista.jpg"
         data-photo="place/gamcheon-sky-vista.jpg" data-slot="place" alt="">
  </div>
  <div class="scrim"></div>
  <p class="photo-credit">Photo: VaneTrz20 / Wikimedia · CC0</p>
  <div class="type">
    <h1 class="display m-type-in">A village that <span class="accent">climbs</span></h1>
    <p class="sub m-type-in delay-1">Gamcheon Culture Village, Busan</p>
  </div>
</section>
```

경로를 확인한다:

```bash
cd .claude/skills/cardnews-render/scripts/test/fixtures
ls -l ../../../assets/reel.css ../../../../../../assets/photos/place/gamcheon-sky-vista.jpg
```

기대: 두 파일 모두 존재. 없으면 단계 수를 다시 세라.

- [ ] **Step 3: 눈으로 한 번 본다**

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화/.claude/skills/cardnews-render/scripts
node -e "
import('playwright').then(async ({chromium}) => {
  const b = await chromium.launch();
  const p = await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  await p.goto('file://' + process.cwd() + '/test/fixtures/scenes-ok.html');
  await p.evaluate(() => document.fonts.ready);
  await p.evaluate(() => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = 1500; } });
  await p.locator('section.reel-scene').screenshot({path:'/tmp/scene-preview.png'});
  await b.close();
});
"
```

`/tmp/scene-preview.png`를 Read로 열어 확인한다: 사진이 프레임을 채우는가, 글자가 읽히는가, 크레딧이 하단 400px 위에 있는가.

- [ ] **Step 4: 커밋**

```bash
git add .claude/skills/cardnews-render/assets/reel.css \
        .claude/skills/cardnews-render/scripts/test/fixtures/scenes-ok.html
git commit -m "feat(reel): 9:16 조판 시스템 — 풀블리드 사진 + 모션 3종

카드 PNG를 캔버스 중앙에 붙이지 않고 HTML 원본에서 다시 조판한다. v4는
사진이 배경 전체라 위아래 색 띠로 가두면 화면 절반이 빈다.

크레딧을 하단 400px 밴드 위에 둔다. 카드에서는 크롭 가드 안에 있어서
QA m2가 지적했다 — 라이선스 의무를 충족시키는 유일한 요소가 시스템이
스스로 잘릴 수 있다고 선언한 자리에 있었다. 되풀이하지 않는다.

INTERNAL 배너는 ffmpeg drawtext가 아니라 CSS로 굽는다. 폰트 의존성이
브라우저 밖으로 나가지 않고 브랜드 시스템 안에 남는다."
```

---

## Task 5: 씬 계획 — 길이 계산과 스키마 검증

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/reel-plan.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/reel-plan.test.mjs`
- Create: `.claude/skills/cardnews-render/assets/reel-plan.example.json`

**Interfaces:**
- Produces: `sceneDuration({ headline, support }) → number` — 밀리초
- Produces: `loadReelPlan(path) → Promise<{ plan: object, issues: string[] }>` — `plan.scenes[].duration_ms`가 채워진 상태로 반환. `issues`가 비지 않으면 렌더하지 않는다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/reel-plan.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneDuration, loadReelPlan } from '../lib/reel-plan.mjs';

test('길이는 단어 수에서 나온다', () => {
  const short = sceneDuration({ headline: 'One two three', support: '' });
  const long = sceneDuration({ headline: 'A village that climbs', support: 'Gamcheon Culture Village, Busan' });
  assert.ok(long > short, '단어가 많으면 길어야 한다');
});

test('길이에 하한과 상한이 있다', () => {
  assert.equal(sceneDuration({ headline: 'Go', support: '' }), 2000);
  const wordy = Array.from({ length: 40 }, () => 'word').join(' ');
  assert.equal(sceneDuration({ headline: wordy, support: '' }), 4500);
});

test('duration_ms를 사람이 덮어쓸 수 있다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [
      { n: 1, role: 'hook', headline: 'A village that climbs', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: 9999 },
      { n: 2, role: 'cta', headline: 'Two words', support: '', photo: 'b.jpg', crop: '50% 50%', duration_ms: null },
    ],
  }));
  const { plan, issues } = await loadReelPlan(p);
  assert.deepEqual(issues, []);
  assert.equal(plan.scenes[0].duration_ms, 9999, '사람이 적은 값을 그대로 쓴다');
  assert.equal(plan.scenes[1].duration_ms, sceneDuration(plan.scenes[1]), 'null이면 계산한다');
});

test('필수 필드가 없으면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [{ n: 1, role: 'hook', headline: 'Hi', support: '' }],
  }));
  const { issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /photo/.test(i)), `photo 누락을 잡아야 한다 — ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => /crop/.test(i)), `crop 누락을 잡아야 한다 — ${JSON.stringify(issues)}`);
});

test('씬이 6개 이상이면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: Array.from({ length: 6 }, (_, i) => ({
      n: i + 1, role: 'body', headline: 'Two words', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: null,
    })),
  }));
  const { issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /4~5/.test(i)), `씬 수 상한을 잡아야 한다 — ${JSON.stringify(issues)}`);
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-plan.test.mjs
```

기대: FAIL — `Cannot find module '../lib/reel-plan.mjs'`

- [ ] **Step 3: 구현한다**

```js
import { readFile } from 'node:fs/promises';

/* Reading speed, not equal division. Giving a three-word headline and a
 * nine-word one the same slot gets both wrong: one lingers, the other cuts off
 * mid-read. */
const LEAD_IN_MS = 400;
const PER_WORD_MS = 280;
const TAIL_MS = 500;
const MIN_MS = 2000;
const MAX_MS = 4500;

/* 4-5 scenes, not 6. Six cards at 15-25s is ~3s per scene with a two-line
 * headline, which is tight on a vertical screen. Which card to drop is an
 * editorial call made in step 1 and approved by a human. */
const MAX_SCENES = 5;
const MIN_SCENES = 3;

const REQUIRED = ['n', 'role', 'headline', 'photo', 'crop'];

export function wordCount(s) {
  return (s ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function sceneDuration({ headline, support }) {
  const words = wordCount(headline) + wordCount(support);
  const raw = LEAD_IN_MS + words * PER_WORD_MS + TAIL_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(raw)));
}

export async function loadReelPlan(path) {
  const issues = [];
  let plan;
  try {
    plan = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    return { plan: null, issues: [`reel plan을 읽을 수 없다: ${path} — ${e.message}`] };
  }

  const scenes = plan.scenes ?? [];
  if (scenes.length > MAX_SCENES || scenes.length < MIN_SCENES) {
    issues.push(`씬이 ${scenes.length}개다 — 4~5개로 맞춰라 (허용 ${MIN_SCENES}~${MAX_SCENES})`);
  }

  for (const s of scenes) {
    for (const key of REQUIRED) {
      if (s[key] === undefined || s[key] === null || s[key] === '') {
        issues.push(`scene ${s.n ?? '?'}: 필수 필드 "${key}"가 없다`);
      }
    }
    if (s.duration_ms === undefined || s.duration_ms === null) {
      s.duration_ms = sceneDuration(s);
    }
  }

  const total = scenes.reduce((a, s) => a + (s.duration_ms ?? 0), 0);
  plan.total_ms = total;

  return { plan, issues };
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-plan.test.mjs
```

기대: 5 pass.

- [ ] **Step 5: 예시 원장을 쓴다**

`assets/reel-plan.example.json`:

```json
{
  "_readme": [
    "릴스 씬 원장. 1단계(씬 구성)가 이 파일을 만들고 사람이 승인한다.",
    "카피는 여기서 새로 쓰지 않는다 — 02_carousel.json이 이미 팩트 출처까지",
    "달아 검증한 문장을 옮긴다. 예외는 CTA 씬 하나뿐이다(카드 06이 QA B1으로",
    "교체됐다).",
    "crop은 1:1 사진을 9:16으로 옮길 때 어느 부분을 살릴지다. 좌우가 잘리므로",
    "사람이 2단계에서 눈으로 확인한다.",
    "duration_ms를 null로 두면 단어 수에서 계산한다. 숫자를 적으면 그 값을 쓴다."
  ],
  "campaign_id": "gamcheon-culture-village",
  "source": "_workspace/02_carousel.json",
  "fps": 30,
  "scenes": [
    {
      "n": 1,
      "from_card": 1,
      "role": "hook",
      "headline": "A village that <span class=\"accent\">climbs</span>",
      "support": "Gamcheon Culture Village, Busan",
      "photo": "place/gamcheon-sky-vista.jpg",
      "crop": "50% 45%",
      "motion": "ken-burns",
      "transition": "cut",
      "duration_ms": null
    }
  ]
}
```

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-plan.mjs \
        .claude/skills/cardnews-render/scripts/test/reel-plan.test.mjs \
        .claude/skills/cardnews-render/assets/reel-plan.example.json
git commit -m "feat(reel): 씬 원장 — 길이는 균등분할이 아니라 읽기 속도에서 나온다

세 단어짜리 헤드라인과 아홉 단어짜리에 같은 시간을 주면 둘 다 틀린다.
0.4 + 단어수 x 0.28 + 0.5초, 하한 2.0 상한 4.5. 사람이 씬별로 덮어쓸 수 있다.

씬은 4~5개다. 카드 6장을 전부 넣으면 씬당 3초에 헤드라인 2줄인데 세로
화면에서 빡빡하다. crop은 필수 필드다 — 1:1을 9:16으로 옮기면 좌우가 잘린다."
```

---

## Task 6: 릴스 전용 검사 — 세이프에어리어와 단어 수

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/reel-checks.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/fixtures/scene-unsafe.html`
- Create: `.claude/skills/cardnews-render/scripts/test/fixtures/scene-wordy.html`
- Create: `.claude/skills/cardnews-render/scripts/test/reel-checks.test.mjs`

**Interfaces:**
- Consumes: `wordCount` from `lib/reel-plan.mjs`
- Produces: `SAFE = { top: 200, bottom: 400 }`
- Produces: `MAX_HEADLINE_WORDS = 6`
- Produces: `checkSafeArea(el, { label }) → Promise<string[]>`
- Produces: `checkWordCount(el, { label }) → Promise<string[]>`

- [ ] **Step 1: 깨진 픽스처 두 개를 만든다**

`test/fixtures/scene-unsafe.html` — CTA를 하단 380px 지점에 놓는다 (인스타 UI가 덮는 자리).

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="../../../assets/reel.css">
<style>
  body { margin: 0; }
  /* Deliberately broken: this sits inside the bottom 400px band. */
  .reel-scene .sub { position: absolute; left: 72px; bottom: 380px; }
</style>
<section class="reel-scene" style="--crop: 50% 50%">
  <div class="scrim"></div>
  <div class="type">
    <h1 class="display">Two words</h1>
    <p class="sub">Book a private day</p>
  </div>
</section>
```

`test/fixtures/scene-wordy.html` — 헤드라인이 7단어.

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="../../../assets/reel.css">
<style> body { margin: 0; } </style>
<section class="reel-scene" style="--crop: 50% 50%">
  <div class="scrim"></div>
  <div class="type">
    <h1 class="display">One two three four five six seven</h1>
  </div>
</section>
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`test/reel-checks.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { checkSafeArea, checkWordCount } from '../lib/reel-checks.mjs';

async function scene(file) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve(import.meta.dirname, 'fixtures', file)).href);
  await page.evaluate(() => document.fonts.ready);
  const el = await page.$('section.reel-scene');
  return { browser, page, el };
}

test('정상 씬은 세이프에어리어를 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkSafeArea(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('하단 400px 안의 요소를 잡는다', async () => {
  const { browser, el } = await scene('scene-unsafe.html');
  const issues = await checkSafeArea(el, { label: 'scene 01' });
  await browser.close();
  assert.ok(issues.length > 0, '하단 밴드 침범을 잡아야 한다');
  assert.match(issues[0], /SAFE AREA/);
});

test('정상 씬은 단어 수를 통과한다', async () => {
  const { browser, el } = await scene('scenes-ok.html');
  const issues = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.deepEqual(issues, []);
});

test('헤드라인 7단어를 잡는다', async () => {
  const { browser, el } = await scene('scene-wordy.html');
  const issues = await checkWordCount(el, { label: 'scene 01' });
  await browser.close();
  assert.ok(issues.length > 0, '7단어 헤드라인을 잡아야 한다');
  assert.match(issues[0], /WORDS/);
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-checks.test.mjs
```

기대: FAIL — `Cannot find module '../lib/reel-checks.mjs'`

- [ ] **Step 4: 구현한다**

```js
import { wordCount } from './reel-plan.mjs';

/* Instagram's own chrome covers these bands: the account row at the top, the
 * caption and action buttons at the bottom. Anything that must be READ has to
 * stay out of them. Decoration and the photograph may run through. */
export const SAFE = { top: 200, bottom: 400 };

/* "Never put more than six words on screen at once" — a vertical screen at
 * arm's length cannot deliver more in the time a scene lasts. Applies to the
 * headline: the support line is read second, not simultaneously. */
export const MAX_HEADLINE_WORDS = 6;

const READABLE = '.display, .sub, .photo-credit, .cta-band, .badge, .label';

export async function checkSafeArea(el, { label }) {
  const bad = await el.evaluate(
    (node, { safe, sel }) => {
      const frame = node.getBoundingClientRect();
      const out = [];
      for (const child of node.querySelectorAll(sel)) {
        const r = child.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const top = r.top - frame.top;
        const bottom = frame.bottom - r.bottom;
        const cls = child.className?.toString?.().trim().replace(/\s+/g, '.') ?? '';
        const who = `${child.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
        // 1px of slack: a layout that sits exactly on the boundary (the default
        // padding does) must not fail on sub-pixel rounding.
        if (top < safe.top - 1) out.push(`${who} is ${Math.round(safe.top - top)}px into the top ${safe.top}px band`);
        if (bottom < safe.bottom - 1) out.push(`${who} is ${Math.round(safe.bottom - bottom)}px into the bottom ${safe.bottom}px band`);
      }
      return out;
    },
    { safe: SAFE, sel: READABLE },
  );

  return bad.map((b) => `${label}: SAFE AREA — ${b}`);
}

export async function checkWordCount(el, { label }) {
  const text = await el.evaluate((node) => node.querySelector('.display')?.textContent ?? '');
  const n = wordCount(text);
  if (n <= MAX_HEADLINE_WORDS) return [];
  return [`${label}: WORDS — headline is ${n} words, limit is ${MAX_HEADLINE_WORDS} ("${text.trim()}")`];
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-checks.test.mjs
```

기대: 4 pass.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-checks.mjs \
        .claude/skills/cardnews-render/scripts/test/reel-checks.test.mjs \
        .claude/skills/cardnews-render/scripts/test/fixtures/scene-unsafe.html \
        .claude/skills/cardnews-render/scripts/test/fixtures/scene-wordy.html
git commit -m "feat(reel): 세이프에어리어·단어 수 검사 + 결함 재현 테스트

일부러 깨진 픽스처 2종으로 두 검사가 실제로 잡는 것을 확인했다.
검사가 작동하는지는 그 방법으로만 알 수 있다 (ADR-014).

초안에 있던 '훅 3초 픽셀 diff' 검사는 폐기했다 — ken-burns가 모든 씬에
걸려 있어 diff가 절대 0이 아니라 항상 통과하는 검사였다. 기계가 무시하는
검사는 없느니만 못하다."
```

---

## Task 7: 대비를 씬당 3프레임에서 잰다

정지 프레임 한 장 측정은 틀린 측정이다. ken-burns가 사진을 확대하는 동안 글자 뒤 배경이 계속 바뀐다. 중간에서 5:1이어도 끝에서 1.8:1일 수 있다.

**Files:**
- Modify: `.claude/skills/cardnews-render/scripts/lib/reel-checks.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/fixtures/scene-drift.html`
- Modify: `.claude/skills/cardnews-render/scripts/test/reel-checks.test.mjs`

**Interfaces:**
- Consumes: `checkContrast` from `lib/contrast.mjs`, `seekTo` from `lib/reel-capture.mjs`
- Produces: `checkContrastOverTime(page, el, { label, durationMs }) → Promise<{ issues: string[], notes: string[] }>`

- [ ] **Step 1: 시간에 따라 대비가 무너지는 픽스처를 만든다**

`test/fixtures/scene-drift.html` — 시작은 검정 배경에 흰 글자(멀쩡), 끝은 흰 배경에 흰 글자(사라짐). **1프레임 검사로는 못 잡는다는 것을 증명하는 픽스처다.**

```html
<!doctype html>
<meta charset="utf-8">
<link rel="stylesheet" href="../../../assets/reel.css">
<style>
  body { margin: 0; }
  /* Starts black, ends white, with white type on top. A single mid-scene
   * measurement reads ~50% grey and passes; the last frame is white on white. */
  .drift { position: absolute; inset: 0; z-index: 0; background: #000; animation: wash 3000ms linear both; }
  @keyframes wash { from { background: #000; } to { background: #fff; } }
  .reel-scene .scrim { display: none; }
</style>
<section class="reel-scene" style="--dur: 3000ms">
  <div class="drift"></div>
  <div class="type"><h1 class="display">Two words</h1></div>
</section>
```

- [ ] **Step 2: 실패하는 테스트를 추가한다**

`test/reel-checks.test.mjs` 끝에 추가:

```js
import { checkContrastOverTime } from '../lib/reel-checks.mjs';

test('씬 중간만 보면 통과하지만 끝에서 무너지는 대비를 잡는다', async () => {
  const { browser, page, el } = await scene('scene-drift.html');
  const { issues } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 3000 });
  await browser.close();
  assert.ok(
    issues.some((i) => /CONTRAST/.test(i)),
    `끝 프레임의 흰 글자 on 흰 배경을 잡아야 한다 — ${JSON.stringify(issues)}`,
  );
});

test('정상 씬은 3프레임 전부 통과한다', async () => {
  const { browser, page, el } = await scene('scenes-ok.html');
  const { issues } = await checkContrastOverTime(page, el, { label: 'scene 01', durationMs: 3000 });
  await browser.close();
  assert.deepEqual(issues, []);
});
```

- [ ] **Step 3: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-checks.test.mjs
```

기대: 새 테스트 2개가 FAIL — `checkContrastOverTime is not a function`

- [ ] **Step 4: 구현한다**

`lib/reel-checks.mjs`에 추가:

```js
import { checkContrast } from './contrast.mjs';
import { seekTo } from './reel-capture.mjs';

/* Three samples, worst wins.
 *
 * A still frame measurement is the wrong measurement here: ken-burns changes
 * what sits behind the type for the whole scene. QA caught exactly this class
 * on the cards (M1 — the URL at 1.75:1 over a bright roof) and that was a
 * STILL image. Moving makes it easier to miss, not harder.
 *
 * The samples deliberately include the last frame: the end state is where a
 * zoom has moved the background furthest from what the author saw. */
export async function checkContrastOverTime(page, el, { label, durationMs }) {
  const marks = [0, Math.round(durationMs / 2), Math.max(0, durationMs - 1)];
  const seen = new Map();
  const notes = [];

  for (const t of marks) {
    await seekTo(page, t);
    const r = await checkContrast(page, el, { label: `${label} @${t}ms` });
    // Same defect at three timestamps is one defect. Key on everything after
    // the timestamp so the dedup does not collapse genuinely different spots.
    for (const i of r.issues) {
      const key = i.replace(/ @\d+ms/, '');
      if (!seen.has(key)) seen.set(key, i);
    }
    notes.push(...r.notes);
  }

  return { issues: [...seen.values()], notes };
}
```

- [ ] **Step 5: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-checks.test.mjs
```

기대: 6 pass.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-checks.mjs \
        .claude/skills/cardnews-render/scripts/test/reel-checks.test.mjs \
        .claude/skills/cardnews-render/scripts/test/fixtures/scene-drift.html
git commit -m "feat(reel): 대비를 씬당 3프레임에서 재고 최악값으로 판정한다

확대하는 동안 글자 뒤 배경이 계속 바뀐다. 중간에서 5:1이어도 끝에서
1.8:1일 수 있다. 픽스처가 정확히 그것이다 — 검정에서 흰색으로 가는 배경에
흰 글자. 중간 프레임만 보면 통과한다.

QA가 카드에서 잡은 M1(URL 1.75:1)이 이 종류인데 그건 정지 이미지였다.
움직이면 더 놓친다."
```

---

## Task 8: 발행 게이트 — QA 판정과 사진 권리

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/reel-gate.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/reel-gate.test.mjs`

**Interfaces:**
- Produces: `decideGate({ qaReportPath, rights }) → Promise<{ internal: boolean, reasons: string[] }>` — `rights`는 씬이 쓰는 사진의 매니페스트 `rights` 문자열 배열

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/reel-gate.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideGate } from '../lib/reel-gate.mjs';

async function qaFile(body) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-'));
  const p = join(dir, 'qa_report.md');
  await writeFile(p, body);
  return p;
}

const CLEAN = ['licensed:wikimedia/CC BY 4.0 — S h y numis', 'licensed:wikimedia/CC0 — VaneTrz20'];

test('QA가 PASS이고 권리가 깨끗하면 발행본이 나온다', async () => {
  const p = await qaFile('# QA\n\n## 4회차\n\n**판정: PASS**   BLOCKER 0\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, false, g.reasons.join(' / '));
});

test('QA가 HOLD면 INTERNAL이다', async () => {
  const p = await qaFile('# QA\n\n## 3회차\n\n**판정: HOLD**   BLOCKER 3\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true);
  assert.ok(g.reasons.some((r) => /QA/.test(r)));
});

test('최신 회차만 본다 — 아래 붙은 옛 PASS에 속지 않는다', async () => {
  const p = await qaFile('# QA\n\n## 3회차\n\n**판정: HOLD**   BLOCKER 3\n\n## 부록: 2회차\n\n**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true, '문서 첫 판정이 최신이다');
});

test('판정을 못 읽으면 INTERNAL이다 (fail-closed)', async () => {
  const p = await qaFile('# QA\n\n아직 판정이 없다.\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true);
});

test('QA 파일이 없으면 INTERNAL이다', async () => {
  const g = await decideGate({ qaReportPath: '/nope/qa_report.md', rights: CLEAN });
  assert.equal(g.internal, true);
});

test('ShareAlike 사진이 섞이면 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: [...CLEAN, 'licensed:wikimedia/CC BY-SA 2.0 — bryan'] });
  assert.equal(g.internal, true);
  assert.ok(g.reasons.some((r) => /SA|ShareAlike/i.test(r)));
});

test('NonCommercial 사진이 섞이면 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['licensed:flickr/CC BY-NC 2.0 — someone'] });
  assert.equal(g.internal, true);
});

test('모르는 권리 문자열이면 INTERNAL이다 (fail-closed)', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['어디선가 받음'] });
  assert.equal(g.internal, true);
});

test('자사 사진과 AI 개념컷은 통과한다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['own', 'ai:gpt-image-2'] });
  assert.equal(g.internal, false, g.reasons.join(' / '));
});
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-gate.test.mjs
```

기대: FAIL — `Cannot find module '../lib/reel-gate.mjs'`

- [ ] **Step 3: 구현한다**

```js
import { readFile } from 'node:fs/promises';

/**
 * Decides whether this render may leave the building.
 *
 * Fail-closed on purpose: the banner appears unless PASS can be positively
 * proven. qa_report.md is markdown and the parse can break; when it breaks the
 * safe side is the side with the banner on it.
 */

/* Any obligation that would follow the video downstream. SA forces the whole
 * reel under the same licence; NC forbids the commercial use this IS; ND
 * forbids the derivative that putting type over a photo already is. */
const BLOCKING = /\b(BY-SA|SA\b|ShareAlike|NC\b|NonCommercial|ND\b|NoDeriv)/i;

/* Recognised, unencumbered provenance. Anything not matching is unknown, and
 * unknown is treated as blocking.
 *
 * "CC BY \d" cannot match "CC BY-SA 2.0" — the digit must follow the space —
 * but BLOCKING is tested first anyway, so the two rules cannot disagree. */
const CLEAR = /(^(own\b|ai:))|\b(CC0|public domain|CC BY \d(\.\d)?|unsplash)\b/i;

export async function decideGate({ qaReportPath, rights = [] }) {
  const reasons = [];

  let verdict = null;
  try {
    const md = await readFile(qaReportPath, 'utf8');
    // The report is newest-first; the first verdict line is the current one.
    const m = md.match(/\*\*판정:\s*([A-Z]+)/);
    verdict = m ? m[1] : null;
  } catch {
    reasons.push(`QA — ${qaReportPath}를 읽을 수 없다`);
  }

  if (verdict === null && reasons.length === 0) {
    reasons.push('QA — 판정 줄을 찾지 못했다 (fail-closed)');
  } else if (verdict && verdict !== 'PASS') {
    reasons.push(`QA — 최신 판정이 ${verdict}다`);
  }

  for (const r of rights) {
    const s = r ?? '';
    if (BLOCKING.test(s)) {
      reasons.push(`LICENCE — "${s}"는 재배포에 조건이 붙는다`);
    } else if (!CLEAR.test(s)) {
      reasons.push(`LICENCE — "${s}"의 권리를 판정할 수 없다 (fail-closed)`);
    }
  }

  return { internal: reasons.length > 0, reasons };
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-gate.test.mjs
```

기대: 9 pass.

- [ ] **Step 5: 현재 저장소 상태로 실제 판정을 본다**

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
node --input-type=module -e "
import { decideGate } from './.claude/skills/cardnews-render/scripts/lib/reel-gate.mjs';
import { readFile } from 'node:fs/promises';
const m = JSON.parse(await readFile('assets/photos/manifest.json','utf8'));
const rights = m.photos.filter(p => p.file.startsWith('place/gamcheon')).map(p => p.rights);
console.log(await decideGate({ qaReportPath: 'output/qa_report.md', rights }));
"
```

기대: `internal: true`, 사유는 QA 판정 하나(사진 권리는 이제 깨끗하다). **사유에 LICENCE가 뜨면 매니페스트를 다시 봐라.**

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-gate.mjs \
        .claude/skills/cardnews-render/scripts/test/reel-gate.test.mjs
git commit -m "feat(reel): 발행 게이트 — 통과를 증명 못 하면 INTERNAL이다

파이프라인은 QA가 HOLD여도 돌아간다. 그래서 사람이 실수로 올릴 수 있다.
QA 최신 판정과 사진 권리를 스크립트가 직접 읽고, 둘 중 하나라도 통과가
아니면 파일명이 reel_INTERNAL.mp4가 되고 배너가 굽힌다.

fail-closed다 — 판정을 못 읽거나 권리 문자열을 모르면 INTERNAL이다.
마크다운 파싱이 깨졌을 때 안전한 쪽은 배너가 붙는 쪽이다."
```

---

## Task 9: 씬 캐시 키

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/lib/reel-cache.mjs`
- Create: `.claude/skills/cardnews-render/scripts/test/reel-cache.test.mjs`

**Interfaces:**
- Produces: `RENDERER_VERSION` — 문자열 상수
- Produces: `sceneKey({ sceneHtml, cssPaths, fontDir, photoPath, durationMs, fps, internal }) → Promise<string>` — 64자 hex

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`test/reel-cache.test.mjs`:

```js
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
```

- [ ] **Step 2: 실패를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-cache.test.mjs
```

기대: FAIL — `Cannot find module '../lib/reel-cache.mjs'`

- [ ] **Step 3: 구현한다**

```js
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Bump when a change makes the SAME input produce a DIFFERENT frame — motion
 * vocabulary, encoder settings, capture timing. Bumping invalidates every
 * cached scene.
 */
export const RENDERER_VERSION = 'reel-1';

/**
 * Everything that can change a rendered scene goes in the key.
 *
 * Hashing the scene HTML alone would be a lie: editing brand.css would leave
 * every cached scene looking current while being stale. A cache that lies is
 * worse than no cache, because the wrong frames ship silently.
 */
export async function sceneKey({ sceneHtml, cssPaths = [], fontDir, photoPath, durationMs, fps, internal }) {
  const h = createHash('sha256');
  h.update(RENDERER_VERSION);
  h.update('\0');
  h.update(sceneHtml);
  h.update('\0');
  h.update(JSON.stringify({ durationMs, fps, internal: Boolean(internal) }));

  for (const p of cssPaths) {
    h.update('\0css:');
    h.update(p);
    h.update(await readFile(p));
  }

  if (fontDir) {
    const names = (await readdir(fontDir)).sort();
    for (const n of names) {
      h.update('\0font:');
      h.update(n);
      h.update(await readFile(join(fontDir, n)));
    }
  }

  if (photoPath) {
    h.update('\0photo:');
    h.update(photoPath);
    h.update(await readFile(photoPath));
  }

  return h.digest('hex');
}
```

- [ ] **Step 4: 통과를 확인한다**

```bash
cd .claude/skills/cardnews-render/scripts && node --test test/reel-cache.test.mjs
```

기대: 7 pass.

- [ ] **Step 5: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/lib/reel-cache.mjs \
        .claude/skills/cardnews-render/scripts/test/reel-cache.test.mjs
git commit -m "feat(reel): 씬 캐시 키에 CSS·폰트·사진·렌더러 버전을 전부 넣는다

씬 HTML만 해싱하면 brand.css를 고쳐도 낡은 씬이 재사용된다. 캐시가
거짓말을 하고, 그건 캐시가 없는 것보다 나쁘다 — 틀린 프레임이 조용히 나간다.

INTERNAL 여부도 키에 들어간다. 배너를 CSS로 굽기 때문에 게이트 상태가
바뀌면 프레임 자체가 달라진다."
```

---

## Task 10: 오케스트레이션 — render-reel.mjs

**Files:**
- Create: `.claude/skills/cardnews-render/scripts/render-reel.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 앞의 모든 모듈
- Produces: CLI — `node .claude/skills/cardnews-render/scripts/render-reel.mjs <reel.html> <reel_plan.json> [outDir]`

- [ ] **Step 1: .gitignore에 캐시를 넣는다**

`.gitignore` 끝에 추가:

```
# 릴스 씬 캐시 — 재생성 가능한 중간물이다. 최종 mp4는 output/에 커밋한다.
_workspace/.reel-cache/
```

- [ ] **Step 2: render-reel.mjs를 쓴다**

```js
#!/usr/bin/env node
/**
 * Sojourn reel renderer.
 *
 * Re-typesets the card copy at 1080x1920, captures each scene deterministically
 * and writes output/reels/reel.mp4.
 *
 * Usage (from the repo root):
 *   node .claude/skills/cardnews-render/scripts/render-reel.mjs \
 *        _workspace/04_reel.html _workspace/04_reel_plan.json [outDir]
 *
 * Lives beside render-cards.mjs on purpose: CLAUDE.md names this directory as
 * the one place render dependencies may live, and a second package.json would
 * let the two renderers drift onto different playwright versions.
 *
 * This script never asks a human anything. Scene-plan approval and the crop
 * confirmation are gates the AGENT opens via mcp__gate__ask_approval.
 */
import { chromium } from 'playwright';
import { mkdir, access, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

import { assertFontsLoaded } from './lib/fonts.mjs';
import { loadPhotoIndex, checkPhotos } from './lib/photos.mjs';
import { loadReelPlan } from './lib/reel-plan.mjs';
import { seekTo, openEncoder, captureScene, FPS } from './lib/reel-capture.mjs';
import { checkSafeArea, checkWordCount, checkContrastOverTime } from './lib/reel-checks.mjs';
import { decideGate } from './lib/reel-gate.mjs';
import { sceneKey } from './lib/reel-cache.mjs';

const W = 1080;
const H = 1920;
const MIN_TOTAL_MS = 15000;
const MAX_TOTAL_MS = 25000;

const [, , htmlArg, planArg, outArg] = process.argv;

if (!htmlArg || !planArg) {
  console.error('usage: node render-reel.mjs <reel.html> <reel_plan.json> [outDir]');
  process.exit(2);
}

const htmlPath = resolve(htmlArg);
const planPath = resolve(planArg);
const outDir = resolve(outArg ?? 'output/reels');
const cacheDir = resolve('_workspace/.reel-cache');
const assetsDir = resolve(import.meta.dirname, '../assets');

for (const p of [htmlPath, planPath]) {
  try {
    await access(p);
  } catch {
    console.error(`input not found: ${p}`);
    process.exit(2);
  }
}

await mkdir(outDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });

const issues = [];
const notes = [];

// --- plan ------------------------------------------------------------------
const { plan, issues: planIssues } = await loadReelPlan(planPath);
issues.push(...planIssues);
if (!plan) {
  console.error('\nISSUES:');
  for (const i of issues) console.error(`  - ${i}`);
  process.exit(1);
}

const fps = plan.fps ?? FPS;

if (plan.total_ms < MIN_TOTAL_MS || plan.total_ms > MAX_TOTAL_MS) {
  notes.push(
    `총 길이 ${(plan.total_ms / 1000).toFixed(1)}초 — 권장 ${MIN_TOTAL_MS / 1000}~${MAX_TOTAL_MS / 1000}초`,
  );
}

// --- gate ------------------------------------------------------------------
const { photoIndex, manifestPath } = await loadPhotoIndex();
const rights = plan.scenes.map((s) => photoIndex.get(s.photo)?.rights ?? null);
const gate = await decideGate({ qaReportPath: resolve('output/qa_report.md'), rights });

if (gate.internal) {
  console.log('GATE: INTERNAL — 발행본이 나오지 않는다');
  for (const r of gate.reasons) console.log(`  · ${r}`);
} else {
  console.log('GATE: 발행 가능');
}

// --- browser ---------------------------------------------------------------
const browser = await chromium.launch();
const pageOpts = { viewport: { width: W, height: H }, deviceScaleFactor: 1 };

// Capture and inspection get separate pages. The contrast check makes every
// glyph transparent to read the background out from under it; sharing a page
// with the capture loop is how you ship a reel with no text on it.
const capturePage = await browser.newPage(pageOpts);
const checkPage = await browser.newPage(pageOpts);

for (const [name, page] of [['capture', capturePage], ['check', checkPage]]) {
  page.on('console', (m) => {
    if (m.type() === 'error') issues.push(`${name} console: ${m.text()}`);
  });
  page.on('requestfailed', (r) => {
    issues.push(`${name} request failed: ${r.url()} (${r.failure()?.errorText})`);
  });
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  if (gate.internal) await page.evaluate(() => document.body.classList.add('internal'));
  const missing = await assertFontsLoaded(page);
  for (const f of missing) issues.push(`${name}: FONT — "${f}"가 로드되지 않았다`);
}

const captureScenes = await capturePage.$$('section.reel-scene');
const checkScenes = await checkPage.$$('section.reel-scene');

if (captureScenes.length !== plan.scenes.length) {
  issues.push(
    `HTML에 씬이 ${captureScenes.length}개인데 원장은 ${plan.scenes.length}개다`,
  );
}

// --- per scene -------------------------------------------------------------
const sceneFiles = [];

for (const [i, spec] of plan.scenes.entries()) {
  const label = `scene ${String(i + 1).padStart(2, '0')}`;
  const capEl = captureScenes[i];
  const chkEl = checkScenes[i];
  if (!capEl || !chkEl) {
    issues.push(`${label}: HTML에 대응하는 <section class="reel-scene">가 없다`);
    continue;
  }

  const box = await capEl.boundingBox();
  if (!box || Math.round(box.width) !== W || Math.round(box.height) !== H) {
    issues.push(`${label}: expected ${W}x${H}, got ${Math.round(box?.width ?? 0)}x${Math.round(box?.height ?? 0)}`);
  }

  // Checks run on the check page so nothing they touch reaches the frames.
  issues.push(...(await checkSafeArea(chkEl, { label })));
  issues.push(...(await checkWordCount(chkEl, { label })));
  issues.push(...(await checkPhotos(chkEl, { photoIndex, manifestPath, label })));
  const c = await checkContrastOverTime(checkPage, chkEl, { label, durationMs: spec.duration_ms });
  issues.push(...c.issues);
  notes.push(...c.notes);

  // Cache.
  const sceneHtml = await capEl.evaluate((el) => el.outerHTML);
  const photoPath = spec.photo ? resolve('assets/photos', spec.photo) : null;
  const key = await sceneKey({
    sceneHtml,
    cssPaths: [join(assetsDir, 'reel.css'), join(assetsDir, 'brand.css')],
    fontDir: join(assetsDir, 'fonts'),
    photoPath,
    durationMs: spec.duration_ms,
    fps,
    internal: gate.internal,
  });
  const cached = join(cacheDir, `${key}.mp4`);

  let hit = true;
  try {
    await access(cached);
  } catch {
    hit = false;
  }

  if (hit) {
    console.log(`${label}: cache hit (${spec.duration_ms}ms)`);
  } else {
    const enc = openEncoder(cached, { fps, width: W, height: H });
    const n = await captureScene({
      page: capturePage,
      el: capEl,
      durationMs: spec.duration_ms,
      fps,
      onFrame: enc.write,
    });
    await enc.close();
    console.log(`${label}: captured ${n} frames (${spec.duration_ms}ms)`);
  }

  sceneFiles.push(cached);
}

await browser.close();

if (issues.length) {
  console.error('\nISSUES:');
  for (const i of issues) console.error(`  - ${i}`);
  console.error('\n검사가 실패했다. mp4를 만들지 않는다.');
  process.exit(1);
}

// --- concat + final encode -------------------------------------------------
function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${cmd} exited ${code}\n${err.slice(-2000)}`)),
    );
  });
}

const listPath = join(cacheDir, 'concat.txt');
await writeFile(listPath, sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));

const silent = join(cacheDir, 'silent.mp4');
await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', silent]);

// Instagram has been known to reject an mp4 with no audio track at all, so a
// silent one goes in. "No sound" is not the same as "no audio stream".
const finalName = gate.internal ? 'reel_INTERNAL.mp4' : 'reel.mp4';
const finalPath = join(outDir, finalName);
await run('ffmpeg', [
  '-y',
  '-i', silent,
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
  '-shortest',
  '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart',
  finalPath,
]);

await rm(silent, { force: true });

// The other name must not linger: a stale reel.mp4 next to a fresh
// reel_INTERNAL.mp4 is exactly the upload accident this gate exists to prevent.
await rm(join(outDir, gate.internal ? 'reel.mp4' : 'reel_INTERNAL.mp4'), { force: true });

console.log(`\n${plan.scenes.length} scene(s), ${(plan.total_ms / 1000).toFixed(1)}s -> ${finalPath}`);

if (notes.length) {
  console.log('\nNOTES (not failures):');
  for (const n of notes) console.log(`  · ${n}`);
}
```

- [ ] **Step 3: 씬 HTML과 원장을 만들어 실제로 돌린다**

`_workspace/04_reel_plan.json`과 `_workspace/04_reel.html`을 `02_carousel.json`의 카드 4~5장에서 만든다. 카피는 새로 쓰지 않는다 — 카드 문장을 그대로 옮긴다. `04_reel.html`의 각 씬은 Task 4의 `scenes-ok.html` 구조를 따르고, 첫 줄에 다음을 넣는다:

```html
<link rel="stylesheet" href="../.claude/skills/cardnews-render/assets/reel.css">
```

그다음:

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
node .claude/skills/cardnews-render/scripts/render-reel.mjs \
     _workspace/04_reel.html _workspace/04_reel_plan.json
echo "exit=$?"
ls -la output/reels/
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,codec_name \
        -show_entries format=duration -of default=noprint_wrappers=1 output/reels/reel_INTERNAL.mp4
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 output/reels/reel_INTERNAL.mp4
```

기대: `1080` · `1920` · `30/1` · `h264` · duration 15~25 · 오디오 `aac`. 파일명이 `reel_INTERNAL.mp4`인 것도 확인하라 — QA가 아직 HOLD다.

- [ ] **Step 4: 배너가 실제로 굽혔는지 눈으로 본다**

```bash
ffmpeg -y -ss 1 -i output/reels/reel_INTERNAL.mp4 -frames:v 1 /tmp/reel-frame.png
```

`/tmp/reel-frame.png`를 Read로 열어 `INTERNAL DRAFT — NOT FOR PUBLICATION` 배너를 확인한다.

- [ ] **Step 5: 캐시가 실제로 먹는지 확인한다**

```bash
time node .claude/skills/cardnews-render/scripts/render-reel.mjs \
     _workspace/04_reel.html _workspace/04_reel_plan.json
```

기대: 모든 씬이 `cache hit`, 첫 실행보다 뚜렷하게 빠름.

이어서 씬 하나만 고친다 — `04_reel.html`의 두 번째 씬 헤드라인 한 단어를 바꾸고 다시 돌린다.

기대: `scene 02`만 `captured N frames`, 나머지는 `cache hit`.

- [ ] **Step 6: 커밋**

```bash
git add .claude/skills/cardnews-render/scripts/render-reel.mjs .gitignore \
        _workspace/04_reel.html _workspace/04_reel_plan.json output/reels/
git commit -m "feat(reel): 오케스트레이션 — 첫 릴스를 뽑는다

검사와 캡처가 페이지를 나눠 쓴다. 대비 검사는 배경을 읽으려고 모든 글자를
투명하게 만드는데, 캡처와 같은 페이지를 쓰면 글자 없는 영상이 나온다.

검사가 하나라도 실패하면 mp4를 만들지 않는다. 무음 AAC 트랙을 넣는다 —
인스타가 오디오 스트림이 아예 없는 mp4를 거부하는 경우가 있다.
반대편 파일명은 지운다: 낡은 reel.mp4가 새 reel_INTERNAL.mp4 옆에 남아
있는 것이 이 게이트가 막으려는 바로 그 사고다.

현재 판정은 INTERNAL이다 (QA 3회차 HOLD). 재검수가 통과하면 배너 없는
reel.mp4가 나온다."
```

---

## Task 11: 드리프트 제거와 문서 갱신

지금 상태로 릴스 에이전트를 돌리면 **만족될 수 없는 조건 앞에서 멈춘다.**

**Files:**
- Modify: `.claude/skills/reels-produce/SKILL.md`
- Modify: `.claude/agents/reels-producer.md`
- Modify: `web/lib/prompts.mjs`
- Modify: `docs/PRD.md`
- Modify: `docs/SHOTLIST.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: reels-produce/SKILL.md를 고친다**

- **선행 조건** 절: 부기 두 줄(라이선스 승인완료·누끼 PNG)을 지운다. 남기는 것은 QA PASS 한 줄과, 새로 넣는 `_workspace/02_carousel.json`이 있을 것
- **씬 구성** 표: 4씬 표를 지우고 이 계획의 4~5씬 규율로 바꾼다 (역할: 훅 / 문제→해법 / 장소 / CTA)
- **훅 3초 규칙**: "움직임 + 큰 글자 + 부기"에서 부기를 뺀다. "훅 카피는 카드 01의 Display를 그대로 쓰되"를 **"훅 카피는 원장이 검증한 문장 중에서 고른다 — 카드 01이어야 하는 것은 아니다. 카드 01은 표지이고 표지는 제목이지 훅이 아니다"**로 바꾼다
- **9:16 변환** 절: "중앙 1080×1080 배치"와 `reframe` 대안을 **HTML 원본 재조판**으로 교체한다
- **Higgsfield MCP 사용** 절과 **⚠️ 부기가 들어간 컷에 AI 생성을 쓰지 마라** 절을 통째로 지운다. 대신 한 문단:

```markdown
## 영상 생성 모델을 쓰지 않는다

모션은 CSS + Playwright + ffmpeg으로 만든다. 크레딧을 쓰지 않는다.

실사진에 image-to-video를 걸면 **AI가 실재하는 장소의 없던 프레임을 그린다** —
골목이 이어지고 사람이 움직이는데 그건 우리가 찍지 않은 감천이다. 카드에서 금지한
것(ADR-010)과 같은 종류의 주장이고, 매번 결과가 달라 검사도 성립하지 않는다.
```

- **자막** 절: "하드 자막(번인)으로 넣는다"를 **"화면의 카피가 곧 자막이다. 별도 자막 트랙을 굽지 않는다 — 세로 화면을 두 번 먹으면서 정보가 늘지 않는다. 나레이션이 없기 때문이다"**로 바꾼다
- **출력** 절: `subtitles.srt`를 지우고 `reel_INTERNAL.mp4` 규칙을 적는다
- **하지 마라** 절: 부기 두 줄을 지운다
- 파일 끝에 한 줄:

```markdown
부기 캐릭터는 사용 보류다 (2026-08-03 사용자 결정). 보류가 풀리면
`.claude/skills/sojourn-brand-system/references/boogie-usage.md`부터 읽어라.
```

- [ ] **Step 2: reels-producer.md를 고친다**

- **선행 조건**: 부기 두 줄을 지운다
- **작업 원칙 2**: "훅 3초에 움직임 + 큰 글자 + 부기"에서 부기를 뺀다
- **작업 원칙 3**: "1:1을 9:16으로 늘리지 않는다. 1080×1920 캔버스에 브랜드 컬러를 깔고 카드를 중앙 1080×1080에 배치한다"를 **"카드 PNG를 붙이지 않는다. HTML 원본에서 9:16으로 다시 조판한다"**로 바꾼다
- **작업 원칙 6** (부기 AI 금지) 전체를 지우고, 번호를 다시 매긴다
- **입력 / 출력**: 입력에 `_workspace/02_carousel.json`을 넣고, 출력에서 `subtitles.srt`를 뺀다
- **에러 핸들링** 표: "필요한 포즈가 공식 카탈로그에 없음"·"`reframe` 결과에서 타이포 잘림"·"크레딧 부족" 세 줄을 지우고 두 줄을 넣는다:

| 상황 | 처리 |
|------|------|
| 렌더러가 ISSUE로 실패 | mp4가 안 나온다. 씬 HTML이나 원장을 고쳐라. 검사를 끄지 마라 |
| 게이트가 INTERNAL 판정 | 정상이다. 내부 시안까지만 쓴다. 게이트를 우회하지 마라 |

- 파일 끝에 Step 1과 같은 부기 포인터 한 줄

- [ ] **Step 3: 콘솔 프리셋을 고친다**

`web/lib/prompts.mjs`의 `reels-producer` 프리셋에서 이 텍스트를

```
씬 구성표(output/reels/scene_plan.md)까지만 만들고 멈춰라.

Higgsfield 크레딧이 부족하므로 영상 생성은 절대 하지 마라.
구성표를 게이트로 승인받되, 승인을 받아도 생성 단계로 넘어가지 마라.
```

다음으로 바꾼다:

```
_workspace/02_carousel.json에서 씬 4~5개를 골라 04_reel_plan.json을 만들고,
scene_plan.md로 사람 승인을 받아라. 승인 후 9:16 조판(04_reel.html)을 하고
각 씬 첫 프레임으로 크롭을 한 번 더 확인받은 뒤 render-reel.mjs를 돌려라.

크레딧을 쓰지 않는다 — 영상 생성 모델을 부르지 마라.
QA가 PASS가 아니면 reel_INTERNAL.mp4가 나오는 것이 정상이다. 게이트를 우회하지 마라.
```

- [ ] **Step 4: SHOTLIST에 영상 항목을 넣는다**

`docs/SHOTLIST.md` 끝에 절을 추가한다:

```markdown
## 영상 클립 (릴스용)

정지 사진을 찍으러 간 자리에서 **같은 구도로 5~10초 클립을 함께 찍는다.**
추가 비용이 거의 없는데 릴스 포맷의 천장이 영구히 올라간다.

현재 릴스는 사진에 느린 확대를 거는 방식이다. 정직한 차선책이지 그 이상이 아니다.

| 우선순위 | 컷 | 왜 |
|---|---|---|
| A5-V | **전용 차량 실내 — 주행 중** | 정지 사진으로는 "차가 있다"까지만 말한다. 움직여야 상품 차별점이 전달된다 |
| A1-V | 감천 골목을 걸어 오르는 시점 | 계단·경사가 사진 한 장으로는 전달이 안 된다 |
| A-V | 해안 도로 주행 (창밖) | 훅 씬 후보. 랜드마크가 안 나와도 된다 |

**촬영 규격:** 세로 9:16, 1080×1920 이상, 30fps. 흔들림 억제.
손에 들고 걸으면 릴스에서 못 쓴다.
```

- [ ] **Step 5: PRD를 갱신한다**

`docs/PRD.md` "현재 상태" 표에서:

- `| 릴스 | 미착수. Higgsfield 크레딧 충전 후 |` 줄을 다음으로 바꾼다:

```
| **릴스 파이프라인** | **구축 완료.** HTML 원본에서 9:16 재조판 → 결정론적 프레임 캡처 → ffmpeg. **크레딧 0.** 검사 7종(기존 4 + 세이프에어리어·단어수·3프레임 대비). 발행 게이트는 fail-closed — QA PASS와 사진 권리를 둘 다 증명해야 배너 없는 `reel.mp4`가 나온다 |
| 릴스 첫 편 | `output/reels/reel_INTERNAL.mp4`. QA 재검수 전이라 배너가 굽혀 있다 |
```

- `| **v4의 발행 차단 사유** | ... |` 줄을 사진 라이선스 해소(`0fb1aa3`) 사실로 고친다
- "다음 작업"의 3번(Higgsfield 크레딧 충전)을 지우고, 그 자리에 **QA 재검수**를 올린다 — 카드 반려 3건이 교정됐고 사진이 교체됐는데 판정은 아직 3회차 HOLD다
- "다음 작업" 1번(사진 병목)을 **영상 클립 촬영**을 포함하도록 고치고 `SHOTLIST.md`의 새 절을 가리킨다
- "사용자 액션 대기"에서 "Higgsfield 크레딧 충전 — 릴스 착수 전"을 지운다

- [ ] **Step 6: CLAUDE.md 변경 이력에 기록한다**

변경 이력 표 끝에 추가:

```
| 2026-08-07 | **릴스 제작 자동화 구축 — 크레딧 0.** HTML 원본에서 9:16 재조판 → CSS 애니메이션 시점 seek → 프레임을 ffmpeg stdin으로 흘림. 씬 단위 해시 캐시. 검사 3종 신설 | cardnews-render/scripts, assets/reel.css, reels-produce, reels-producer, web/prompts | 릴스가 Higgsfield 크레딧에 막혀 있다고 기록돼 있었는데, 카드 재활용 릴스는 카드 렌더와 같은 도구로 전부 된다. 실사진 image-to-video는 크레딧 이전에 ADR-010 위반이다 — AI가 실재 장소의 없던 프레임을 그린다 |
| 2026-08-07 | **폰트를 로컬 woff2로 고정.** `brand.css`의 Google Fonts `@import` 제거 | assets/fonts, brand.css, lib/fonts.mjs | 네트워크가 실패하면 대체 글꼴로 렌더되는데 `document.fonts.ready`는 그래도 resolve해서 **렌더러가 틀린 결과를 성공으로 보고했다.** 카드는 사람이 한 장씩 봐서 견뎠지만 프레임 수백 장에는 통하지 않는다. 카드 6장 sha256 6/6 동일 확인 |
| 2026-08-07 | 대비·사진 검사를 `lib/`으로 추출 | cardnews-render/scripts | 릴스가 같은 검사를 쓴다. 613줄 단일 스크립트라 밖에서 못 썼다. 동작 불변 — 카드 재렌더 sha256으로 확인 |
| 2026-08-07 | **릴스 발행 게이트 — fail-closed.** QA 판정과 사진 권리를 스크립트가 직접 읽고, 통과를 증명 못 하면 `reel_INTERNAL.mp4` + 배너 | render-reel.mjs, reel-gate.mjs | 파이프라인은 QA가 HOLD여도 돈다. "내부 시안까지만"이 사람의 기억이 아니라 파일 자체의 성질이어야 한다 |
| 2026-08-07 | `SHOTLIST.md`에 **영상 클립 절 신설** | docs/SHOTLIST.md | 릴스 포맷의 천장은 동영상 소재가 없다는 데서 온다. 사진 찍으러 간 자리에서 5~10초 클립을 같이 찍으면 비용 없이 천장이 올라간다 |
```

- [ ] **Step 7: 드리프트가 남았는지 확인한다**

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
grep -rn "부기\|boogie\|boogi" .claude/skills/reels-produce/ .claude/agents/reels-producer.md
grep -rn "크레딧\|Higgsfield\|reframe\|subtitles.srt\|1080×1080에 배치\|중앙 1080" \
     .claude/skills/reels-produce/ .claude/agents/reels-producer.md web/lib/prompts.mjs
```

기대: 부기는 각 파일의 마지막 포인터 한 줄만. Higgsfield·reframe·subtitles.srt·중앙 배치는 0건.

- [ ] **Step 8: 전체 테스트를 돌린다**

```bash
cd .claude/skills/cardnews-render/scripts && npm test
cd ../../../../web && npm test
```

기대: 양쪽 전부 PASS.

- [ ] **Step 9: 커밋**

```bash
cd /Users/eric/orca/workspaces/sojourn-cardnews-v2/릴스영상자동화
git add .claude/skills/reels-produce/SKILL.md .claude/agents/reels-producer.md \
        web/lib/prompts.mjs docs/PRD.md docs/SHOTLIST.md CLAUDE.md
git commit -m "docs(reel): 드리프트 제거 — 부기 선행조건과 크레딧 게이트를 걷어낸다

릴스 스킬과 에이전트가 아직 '부기 라이선스 승인완료'를 선행 조건으로
요구했다. 부기는 2026-08-03에 사용 보류가 확정됐는데 그때 오케스트레이터
에서만 지우고 릴스 본체엔 남았다. 그 상태로 에이전트를 돌리면 만족될 수
없는 조건 앞에서 멈춘다. 규정 원문은 boogie-usage.md에 전부 있으므로
포인터 한 줄만 남기고 지운다.

'중앙 1080x1080 배치'와 자막 필수 규정도 v1 시절 것이다. 콘솔 프리셋의
'크레딧 부족하니 생성 금지'는 이제 사실이 아니다 — 크레딧을 안 쓴다.

SHOTLIST에 영상 클립 절을 넣었다. 이 포맷의 천장은 동영상 소재가 없다는
데서 오고, 그건 코드로 못 푼다."
```

---

## Self-Review

**스펙 커버리지**

| 설계 문서 절 | 태스크 |
|---|---|
| 데이터 흐름 | 5 (원장) · 10 (오케스트레이션) |
| 씬 단위 렌더 + 해시 캐시 | 9 · 10 |
| 폰트 로컬화 | 1 |
| 프레임 캡처 (stdin 파이프) | 3 |
| 검사/캡처 페이지 분리 | 10 |
| 모션 어휘 3종 | 4 |
| 씬 길이 규칙 · 4~5씬 · 훅 규정 완화 | 5 · 11 |
| 검사 7종 | 2(재사용 4) · 6(세이프에어리어·단어수) · 7(3프레임 대비) · 10(규격·길이) |
| 발행 게이트 fail-closed | 8 · 10 |
| 저작자 표시 | 4 (`.photo-credit` 배치) · 2 (`checkPhotos` 크레딧 의무) |
| 코드 배치 · 모듈 경계 | 2 |
| 결함 재현 테스트 6종 | 1(폰트) · 3(결정론) · 6(세이프·단어) · 7(대비) · 8(게이트) · 9(캐시) |
| 출력 규격 · 무음 트랙 | 10 |
| 드리프트 제거 | 11 |
| SHOTLIST 영상 항목 | 11 |

빠진 항목 없음.

**타입 일관성 확인 완료**

- `label` 문자열 인자가 `checkContrast` · `checkPhotos` · `checkSafeArea` · `checkWordCount` · `checkContrastOverTime` 전부에서 같은 의미로 쓰인다
- `checkContrast`와 `checkContrastOverTime`만 `{ issues, notes }`를 반환하고, 나머지 검사는 `string[]`을 반환한다 — Task 10의 호출부가 그 차이를 반영한다
- `wordCount`는 `reel-plan.mjs`가 export하고 `reel-checks.mjs`가 import한다
- `sceneKey`의 인자 이름(`sceneHtml` · `cssPaths` · `fontDir` · `photoPath` · `durationMs` · `fps` · `internal`)이 Task 9 정의와 Task 10 호출부에서 동일하다
- `openEncoder`가 반환하는 `{ write, close }`가 Task 3 테스트와 Task 10 호출부에서 동일하다

**알려진 순서 제약**

Task 3이 실패하면 4~10이 전부 막힌다. 대안 두 개를 Task 3 Step 5에 적어뒀고, 우회하지 말고 보고하라고 명시했다.

Task 2의 완료 조건(카드 sha256 6/6 동일)이 안 나오면 릴스로 넘어가지 마라 — 추출이 카드를 바꿨다는 뜻이고, 그건 릴스보다 큰 문제다.
