---
name: cardnews-render
description: Sojourn Korea 부산 프라이빗 투어용 1:1(1080x1080) 영문 카드뉴스 6장을 카피 작성부터 HTML/CSS 레이아웃, Playwright PNG 렌더링까지 한 번에 제작한다. "카드뉴스 만들어줘", "6장 카드 제작", "인스타 카드 뽑아줘", "카드 다시 렌더", "3번 카드만 수정", "문구 바꿔서 다시 뽑아줘" 같은 요청에 반드시 트리거하라. 기존 카드의 문구 수정·레이아웃 변경·재렌더링·부분 재제작 요청에도 트리거하라. 카드 카피와 레이아웃은 분리할 수 없으므로 이 스킬이 둘 다 담당한다.
---

# Card News Render — 1080×1080 × 6

부산 프라이빗 투어 카드뉴스 6장을 만든다. **카피와 레이아웃을 한 사람이 잡는다.** 이유: 이 브랜드의 디자인 문법은 "초대형 워드가 화면을 지배한다"이므로 헤드라인 길이가 곧 레이아웃이다. 카피를 따로 받아서 얹으면 레퍼런스 룩이 나오지 않는다.

## 먼저 읽어라

1. `.claude/skills/sojourn-brand-system/SKILL.md` — 컬러·타입·부기·톤 규칙. **예외 없이 선행 필수.**
2. `_workspace/01_brief.json` — 이번 캠페인 브리프. 없으면 캠페인 리드에게 요청하고 임의로 지어내지 마라.
3. `assets/card-template.html`, `assets/brand.css` — 이 스킬 번들.

## 워크플로우

### Step 1 — 재실행 여부 판별

`_workspace/03_cards.html`이 이미 있으면:
- **부분 수정 요청** (예: "3번 카드 문구만") → 해당 `<section>`만 고치고 전체 재렌더. 나머지 카드는 건드리지 마라.
- **새 캠페인** → 기존 파일을 `_workspace/03_cards_prev.html`로 옮기고 새로 만든다.

### Step 2 — 6장 스켈레톤 확정

브리프의 `card_skeleton`을 따른다. 브리프에 없으면 아래 기본 골격을 쓴다.

| # | 역할 | 아키타입 | 배경 |
|---|------|----------|------|
| 01 | HOOK — 훅 한 방 | `.lay-bleed` | blue |
| 02 | PROBLEM — 대안의 문제 | `.lay-split` | blue |
| 03 | SOLUTION — 우리의 답 | `.lay-stack` | white |
| 04 | PROOF — 후기/근거 | `.lay-quote` | ink |
| 05 | ITINERARY — 코스 | `.lay-steps` | blue |
| 06 | CTA — 행동 요청 | `.lay-cta` | grad |

배경 리듬 `blue → blue → white → ink → blue → grad`는 브랜드 시스템의 권장 리듬을 만족한다. 바꾸려면 white/ink가 연속되지 않게 하라. 이유: 인스타 프로필 그리드에서 3열로 잘렸을 때 밝은 카드가 뭉치면 세트가 흩어져 보인다.

### Step 3 — 카피 작성

**Display (초대형 워드):** 1~3 단어, 14자 이내, UPPERCASE. 문장이 아니라 덩어리다.
- ✗ `EXPERIENCE THE BEAUTY OF BUSAN` — 문장이라 크게 못 키운다
- ○ `ONE DAY` / `IN BUSAN` — 두 덩어리로 쪼개 층을 만든다

길어지면 **크기를 줄이지 말고 단어를 바꿔라.** `d-xl`(210px)을 `d-m`(108px)으로 내리는 순간 레퍼런스 룩이 죽는다.

**Sub/Body:** 8단어 이하, `you` 중심, 고유명사와 숫자를 넣는다. 브랜드 시스템 §6의 금지 표현(`hidden gem`, `must-visit`, `breathtaking` 등)을 쓰지 마라.

**두 줄 이상 Display는 줄마다 다른 처리를 준다** — `t-solid` / `t-outline` / `t-box` / `t-sand`를 섞어 층을 만든다. 전부 같은 처리면 그냥 큰 글씨일 뿐 디자인이 아니다.

### Step 4 — HTML 작성

`assets/card-template.html`을 `_workspace/03_cards.html`로 복사한 뒤 편집한다.

지켜야 할 것:
- `<section class="card">` 래퍼, `.lockup`, `.pager`는 **6장 전부 동일하게 유지**한다. 이 고정 요소가 6장을 한 세트로 묶는다.
- `<link rel="stylesheet">` 경로를 이 스킬의 `assets/brand.css` 실제 상대 경로로 고치고, 부기 `<img src>`도 `assets/boogie/boogie-cutout.png`의 실제 상대 경로로 고쳐라. 경로가 틀리면 렌더는 성공하는데 폰트/캐릭터만 빠진 카드가 나온다.
- 색·크기를 인라인 `style`로 새로 정의하지 마라. 브랜드 클래스를 써라. 위치 미세조정(`margin-top`, `max-width`)만 인라인 허용.
- 부기는 6장 중 3~5장. **01에는 반드시** 넣는다.
- **부기가 등장하는 카드마다 `.char-credit`을 넣어라** — `BOOGI ©2021. Busan Metropolitan City All Rights Reserved.` 부산시 저작권 표기는 선택이 아니라 라이선스 조건이다.
- **부기에 `transform: scaleX(-1)`을 쓰지 마라.** 반전 시 스마트 글래스 우측 돌출 바를 따로 적용해야 한다는 규정이 있어 단순 미러링은 규정 위반이다. 높이만 지정하고 폭은 `auto`로 둬서 비율도 지키게 하라.
- 콜라주 요소(`.blob`)는 카드당 최대 2개.

### Step 5 — 렌더

최초 1회 셋업:
```bash
cd .claude/skills/cardnews-render/scripts && npm i && npx playwright install chromium
```

렌더:
```bash
node .claude/skills/cardnews-render/scripts/render-cards.mjs _workspace/03_cards.html output/cards
```

스크립트가 자동 검사하는 것:
- 각 카드가 정확히 1080×1080인지
- 세이프에어리어 밖으로 텍스트가 넘쳤는지 (`.bleed-*`, `.boogie`, `.blob`, `.cta-band`는 의도적 예외라 제외)
- 본문이 상단 락업이나 하단 페이저와 겹쳤는지
- **부기 라이선스**: 좌우 반전 여부 / 비율 왜곡 여부 / `.char-credit` 저작권 표기 누락 여부
- 폰트/이미지 로딩 실패

**exit code가 0이 아니면 PNG가 나왔더라도 완료가 아니다.** 보고된 문제를 고치고 재렌더하라. 오버플로우 경고를 무시하고 넘긴 카드는 인스타에서 글자가 잘린 채 발행된다.

### Step 6 — 자가 확인

렌더된 PNG를 **직접 읽어서(Read)** 눈으로 확인한다. 스크립트는 기하학만 보지 "읽히는지"는 못 본다:
- 초대형 워드가 부기에 가려 안 읽히는가
- 흰 배경 카드에 흰 텍스트가 있는가
- 6장을 나란히 놓았을 때 같은 브랜드로 보이는가

## 출력

- `_workspace/03_cards.html` — 편집 가능한 소스 (보존)
- `output/cards/01.png` ~ `06.png` — 최종 산출물

완료 보고에는 각 카드의 역할 · Display 카피 · 배경색을 표로 담아라. 다음 단계(brand-qa, reels-producer)가 이 표를 입력으로 쓴다.

## 하지 마라

- 이미지 생성 AI로 카드를 만들지 마라. 이유: 텍스트를 정확히 못 그려서 오타가 박힌 채 발행된다. 배경 질감 생성에만 쓴다.
- **AI로 부기의 새 포즈·표정·의상을 만들지 마라.** 이유: 부기 라이선스가 2차적 저작물 작성을 금지한다. 포즈가 더 필요하면 공식 응용동작 카탈로그(`sojourn-brand-system/references/boogie-usage.md` §5)에서 고른다.
- 브랜드 시스템에 없는 색을 추가하지 마라. 6장 일관성이 깨진다.
- 부기 원본 `references/boogie.jpeg`를 직접 참조하지 마라. 이유: 흰 배경 JPEG라 블루 카드 위에 흰 사각형이 남는다. 누끼 PNG만 쓴다.
- 렌더 실패를 "PNG는 나왔으니 괜찮다"고 넘기지 마라.
