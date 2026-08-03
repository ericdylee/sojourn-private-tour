---
name: busan-campaign
description: Sojourn Korea 부산 프라이빗 투어 마케팅 캠페인 전체를 오케스트레이션한다. 캠페인 브리프 → 카드뉴스 6장(1080x1080) + 영문 블로그 3000자 + Threads/LinkedIn/X 포스팅 → 브랜드 QA → 인스타 릴스까지 6인 에이전트 팀으로 한 번에 돌린다. "캠페인 돌려줘", "부산 투어 홍보물 만들어줘", "이번 주 콘텐츠 제작", "마케팅 세트 뽑아줘", "카드뉴스랑 블로그랑 SNS 다 만들어줘" 같은 요청에 반드시 트리거하라. 후속 요청 — "다시 실행", "재실행", "업데이트", "수정해서 다시", "카드만 다시", "블로그만 보완", "이전 결과 기반으로 개선", "지난 캠페인 소재 바꿔서" — 에도 반드시 트리거하라. 개별 산출물 하나만 요청하면 해당 전용 스킬로 넘겨도 된다.
---

# Busan Campaign Orchestrator

부산 프라이빗 투어 캠페인 1회분을 팀으로 생산한다. 산출물은 **카드뉴스 6장 + 블로그 1편 + SNS 3편 (+ 릴스 1편)**이며, 전부 하나의 브리프에서 파생된다.

## 실행 모드: 하이브리드

| Phase | 모드 | 이유 |
|-------|------|------|
| 1 브리프 | 단독 (`campaign-strategist`) | 결정이 하나로 수렴해야 한다. 병렬화할 것이 없다 |
| 2 제작 | **에이전트 팀** | 세 제작자가 서로 무엇을 썼는지 알아야 중복을 피한다. 실시간 교환이 필요 |
| 3 검수 | 서브 에이전트 (`brand-qa`) | 독립성이 품질의 핵심. 제작 팀에 섞이면 검수가 무뎌진다 |
| 4 릴스 | 단독 (`reels-producer`) | 승인 게이트가 있는 순차 작업 |

**모든 Agent 호출에 `model: "opus"`를 명시하라.**

## Phase 0 — 컨텍스트 확인

먼저 무엇을 하는 실행인지 판별한다. 이 판별을 건너뛰면 사용자가 "카드만 고쳐줘"라고 했는데 전체를 갈아엎는다.

```
_workspace/01_brief.json 없음
  → 초기 실행. Phase 1부터 전체.

_workspace/01_brief.json 있음 + 사용자가 부분 수정 요청
  → 부분 재실행. 해당 에이전트만 재호출. 나머지 산출물은 보존.
    (예: "3번 카드 문구만" → card-producer만, "링크드인만" → social-writer만)

_workspace/01_brief.json 있음 + 새 소재
  → 새 실행. _workspace/ → _workspace_prev/, output/ → output_prev/ 로 이동 후 Phase 1부터.
```

이어서 선행 자산을 확인한다:
- `assets/boogie/boogie-cutout.png` 존재 여부 → 없으면 **자산 준비**부터 (아래)
- `.claude/skills/cardnews-render/scripts/node_modules` 존재 여부 → 없으면 렌더 셋업부터

### 자산 준비 (최초 1회)

`references/boogie.jpeg`는 465×659 흰 배경 JPEG다. 그대로는 블루 카드에 흰 사각형이 남는다.

**착수 전 `sojourn-brand-system/references/boogie-usage.md`를 읽어라.** 부기는 부산시 저작물이고 허용되는 가공이 제한적이다.

1. **고해상도 공식 에셋 확보가 최우선.** 부산시 캐릭터 페이지에서 원본을 받으면 아래 2·3단계가 불필요해진다. 라이선스 승인 신청 시 응용동작 3D 에셋 일체를 함께 요청하라
2. Higgsfield `remove_background` → `assets/boogie/boogie-cutout.png` — 배경 제거는 캐릭터를 바꾸지 않으므로 허용된다
3. 결과를 **눈으로 확인.** 흰 캐릭터 + 흰 배경이라 몸통 외곽이 파먹힐 수 있다. 외곽 훼손은 형태규정 위반이기도 하다. 깨졌으면 재시도
4. (권장) `upscale_image` → `assets/boogie/boogie-cutout@2x.png`

**하지 마라:** AI로 부기의 새 포즈·표정·의상을 생성하는 것. 라이선스가 2차적 저작물 작성을 금지한다. 포즈가 더 필요하면 공식 응용동작 카탈로그에서 고른다.

렌더 셋업:
```bash
cd .claude/skills/cardnews-render/scripts && npm i && npx playwright install chromium
```

## Phase 1 — 브리프 (단독)

`campaign-strategist`를 `model: "opus"`로 호출한다.

소재가 없으면 후보 3개를 제안하고 사용자에게 고르게 한다. 임의로 정하고 진행하지 마라.

산출: `_workspace/01_brief.json`

**게이트:** 브리프의 `landing.status`가 200이 아니거나 `facts`에 UNVERIFIED가 있으면 사용자에게 먼저 보고한다. 진행은 가능하나, 해당 사실은 뒤 단계에서 쓰이지 않는다.

## Phase 2 — 제작 (에이전트 팀)

`TeamCreate`로 3인 팀을 구성한다: `card-producer`, `blog-writer`, `social-writer`.
`TaskCreate`로 작업을 할당하고, 팀원들은 `SendMessage`로 자체 조율한다.

**팀 내부 교환 의무 (중복 방지의 핵심):**
```
card-producer  ──확정 Display 카피 목록──→ blog-writer, social-writer
blog-writer    ──핵심 문단 요지────────→ social-writer
전원           ──facts 질의───────────→ campaign-strategist
```

역할 분담 원칙:
- 카드 = **훅과 결론** (짧고 강하게)
- 블로그 = **과정과 근거** (카드가 생략한 이유·비교·조건)
- SNS = **채널별 각도** (장면 / 문제 / 결과)

셋이 같은 문장을 쓰면 전부 얕아진다.

산출: `output/cards/01~06.png`, `output/blog.md`, `output/social.json`

## Phase 3 — 검수 (서브 에이전트)

`brand-qa`를 `general-purpose` 타입 + `model: "opus"`로 호출한다.

**증분 검수를 쓴다.** 전체 완성 후 1회가 아니라 각 산출물 완성 직후 해당 항목을 검수한다. 브리프의 팩트 오류를 카드 단계에서 잡으면 카드 하나를 고치지만, 마지막에 잡으면 넷을 전부 고친다.

산출: `output/qa_report.md`

**수정 루프:** BLOCKER/MAJOR가 있으면 `brand-qa`가 담당 에이전트에게 직접 반려한다. **최대 2회**까지 돌리고, 그래도 남으면 사용자에게 에스컬레이션한다. 같은 지적을 3회 반복하지 마라 — 에이전트가 못 고치는 문제라면 사람이 결정할 문제다.

**게이트:** 판정이 PASS가 아니면 Phase 4로 넘어가지 않는다.

## Phase 4 — 릴스 (단독, 선택)

`reels-producer`를 `model: "opus"`로 호출한다.

1. 씬 구성표(`output/reels/scene_plan.md`)를 먼저 만들어 **사용자 승인**을 받는다
2. 승인 후 Higgsfield로 생성
3. 완성 후 `brand-qa`에게 재검수 요청

**게이트:** 부기 라이선스 승인완료 + QA PASS. 둘 중 하나라도 아니면 착수하지 않는다.

## 데이터 전달

| 경로 | 방식 |
|------|------|
| Phase 간 | 파일 기반 — `_workspace/`(중간, 보존) → `output/`(최종) |
| Phase 2 팀 내부 | 메시지(`SendMessage`) + 태스크(`TaskCreate`) |
| QA 반려 | 메시지 — 담당자에게 직접. 리드 경유 금지 |

```
_workspace/          01_brief.json · 03_cards.html · (prev 백업)
output/              cards/ · blog.md · social.json · qa_report.md · reels/
assets/boogie/       boogie-cutout.png · boogie-cutout@2x.png
```

`_workspace/`는 지우지 마라. 사후 검증과 부분 재실행의 근거다.

## 에러 핸들링

| 상황 | 처리 |
|------|------|
| 에이전트 실패 | 1회 재시도. 재실패 시 해당 산출물 없이 진행하고 **최종 보고에 누락을 명시**한다 |
| 랜딩 URL 404 | 전 산출물의 링크를 루트 도메인으로 대체하고 사용자에게 보고. 죽은 링크 발행 금지 |
| 팩트 상충 | 삭제하지 말고 출처를 병기해 사용자에게 판단을 넘긴다 |
| 부기 라이선스 미승인 | 내부 시안까지만 생산. 발행 판정은 HOLD |
| playwright 미설치 | 셋업 명령 실행. **프로젝트 루트에 package.json을 만들지 마라** — 저장소 Stop 훅이 없는 npm 스크립트를 돌려 매 턴 실패한다 |
| Higgsfield 크레딧 부족 | Phase 4 중단, 사용자 보고. 품질을 낮춰 우회하지 마라 |

## 완료 보고 형식

```markdown
## 캠페인: {campaign_id}
소재 / 페르소나 / 앵글

| 산출물 | 상태 | 경로 |
|--------|------|------|
| 카드뉴스 6장 | ✅ | output/cards/ |
| 블로그 (n자) | ✅ | output/blog.md |
| SNS 3편 | ✅ | output/social.json |
| QA | PASS/HOLD | output/qa_report.md |
| 릴스 | ✅/미진행 | output/reels/ |

**미해결:** (누락·UNVERIFIED·에스컬레이션 항목)
**다음 액션:** (사용자가 해야 할 일)
```

마지막에 피드백을 한 번 물어라: "결과에서 고칠 부분이나, 팀 구성·순서에서 바꾸고 싶은 점이 있나요?" 답이 없으면 넘어간다.

## 테스트 시나리오

**정상 흐름**
> "이번 주 소재는 감천문화마을 오전 타임. 캠페인 돌려줘"
→ Phase 0 초기 실행 판별 → 자산 준비 확인 → 브리프(persona=visitor) → 팀 3인 병렬 제작 → 증분 QA → PASS → 릴스 여부 확인 → 완료 보고.

**에러 흐름**
> "캠페인 돌려줘" (부기 누끼 PNG 없음 + 랜딩 404)
→ Phase 0에서 누끼 PNG 부재 감지 → 자산 준비 선행 → 브리프 단계에서 `landing.status: 404` 기록 및 사용자 보고 → CTA를 루트 도메인으로 대체해 제작 진행 → QA가 F(라이선스 미승인) BLOCKER 판정 → **HOLD** → 내부 시안까지만 산출하고 발행 보류를 보고.

**부분 재실행 흐름**
> "3번 카드 문구만 바꿔줘"
→ Phase 0에서 부분 재실행 판별 → `card-producer`만 호출 → 3번 `<section>`만 수정 후 전체 재렌더 → `brand-qa`가 A항목만 재검수 → 블로그·SNS는 손대지 않음.
