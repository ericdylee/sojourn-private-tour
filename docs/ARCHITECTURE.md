# 아키텍처

이 저장소의 산출물은 코드가 아니라 **마케팅 콘텐츠**다. 따라서 아키텍처는 "코드가 어디 있는가"가 아니라 **"누가 무엇을 만들고, 산출물이 어떤 경로로 흐르며, 어디서 검증되는가"** 를 규정한다.

## 디렉토리 구조

```
.claude/
├── agents/            에이전트 5인 — "누가 하는가"
│   ├── card-producer.md
│   ├── blog-writer.md
│   ├── social-writer.md
│   ├── brand-qa.md
│   └── reels-producer.md
└── skills/            스킬 8개 — "어떻게 하는가"
    ├── busan-campaign/            오케스트레이터
    ├── sojourn-brand-system/      브랜드 단일 진실 공급원
    │   └── references/boogie-usage.md
    ├── campaign-brief/
    ├── cardnews-render/
    │   ├── assets/brand.css              디자인 토큰 + 레이아웃 아키타입
    │   ├── assets/card-template.html     6장 스켈레톤
    │   └── scripts/render-cards.mjs      Playwright 렌더러 + 자동 검사
    ├── longform-blog/
    ├── social-posts/
    ├── brand-qa-check/
    └── reels-produce/

docs/               기획·설계 문서 (이 폴더)
references/         원본 참고 자산 — boogie.jpeg, reference1/2.jpeg, 부기 공식 가이드북 PDF 2종
assets/boogie/      부기 누끼 PNG (라이선스 승인 후 생성)
_workspace/         중간 산출물 — 보존
output/             최종 산출물
```

**루트에 `package.json`을 만들지 마라.** `.claude/settings.json`의 Stop 훅이 루트 package.json을 감지하면 존재하지 않는 `npm run lint/build/test`를 매 턴 실행해 실패한다. 렌더 의존성은 `.claude/skills/cardnews-render/scripts/`에 격리한다.

## 패턴

### 에이전트와 스킬의 분리

에이전트는 **역할·원칙·통신 프로토콜**을 담고, 스킬은 **작업 절차**를 담는다. 같은 스킬을 여러 에이전트가 참조할 수 있고(`sojourn-brand-system`은 5명이 참조), 한 에이전트가 여러 스킬을 쓸 수 있다.

이렇게 나누는 이유: 브랜드 규칙이 바뀌면 스킬 한 곳만 고치면 되고, 팀 구성이 바뀌면 에이전트 정의만 고치면 된다.

### 실행 모드: 하이브리드

| Phase | 모드 | 이유 |
|-------|------|------|
| 1 브리프 | 단독 | 결정이 하나로 수렴해야 한다. 병렬화할 것이 없다 |
| 2 제작 | **에이전트 팀** | 세 제작자가 서로 무엇을 썼는지 알아야 중복을 피한다 |
| 3 검수 | 서브 에이전트 | 독립성이 품질의 핵심. 제작 팀에 섞이면 검수가 무뎌진다 |
| 4 릴스 | 단독 | 승인 게이트가 있는 순차 작업 |

모든 Agent 호출에 `model: "opus"`를 명시한다.

### 3층 검증

같은 오류를 세 번 서로 다른 방식으로 잡는다. 한 층을 통과해도 다음 층에서 걸린다.

| 층 | 무엇을 잡는가 | 한계 |
|----|--------------|------|
| **CSS 클래스** | 색·크기·레이아웃 이탈 — 애초에 만들 수 없게 한다 | 규칙 안에서의 잘못된 선택은 못 막는다 |
| **렌더 스크립트** | 규격 이탈, 텍스트 잘림, 락업 충돌, 부기 반전·비율왜곡·크레딧 누락 | 기하학만 본다. "읽히는가"는 모른다 |
| **brand-qa 에이전트** | 팩트 상충, 링크 생존, 채널 규격, 톤, 가독성 | 사람의 최종 판단은 대체하지 않는다 |

렌더 스크립트가 기계적으로 잡을 수 있는 것을 QA 에이전트에게 맡기지 마라. 반대로 "저작권 표기가 캐릭터에 가려 안 읽히는" 문제는 스크립트가 통과시키므로 QA가 이미지를 열어 봐야 한다.

## 데이터 흐름

```
사용자: 소재 지정
   ↓
Phase 1  사람 (웹 콘솔 브리프 화면) ──→ _workspace/01_brief.json
   │                              (페르소나·앵글·카드 스켈레톤·SEO·팩트 원장·랜딩 상태)
   │     게이트: landing.status != 200 이거나 facts에 UNVERIFIED 존재 → 사용자에게 보고
   ↓
Phase 2  [에이전트 팀 — 병렬 + SendMessage 자체 조율]
   ├── card-producer  → _workspace/03_cards.html → output/cards/01~06.png
   ├── blog-writer    → output/blog.md
   └── social-writer  → output/social.json
   │
   │   팀 내부 교환 (중복 방지):
   │     card-producer ──확정 Display 카피──→ blog-writer, social-writer
   │     blog-writer   ──핵심 문단 요지────→ social-writer
   │     전원          ──facts 질의───────→ 사용자 (게이트 툴)
   ↓
Phase 3  brand-qa (증분 검수) ──→ output/qa_report.md
   │     반려 시 담당 에이전트에게 직접 전달. 최대 2회 루프
   │     게이트: PASS 아니면 **발행** 불가 (Phase 4 착수는 막지 않는다)
   ↓
Phase 4  reels-producer ──→ output/reels/
         게이트: 없다 — 착수는 언제나 가능하다.
         QA PASS는 render-reel.mjs의 발행 게이트가 fail-closed로 판정한다:
         PASS가 증명되지 않으면 배너가 구워진 reel_INTERNAL.mp4만 나온다
```

### 전달 방식

| 경로 | 방식 | 이유 |
|------|------|------|
| Phase 간 | 파일 (`_workspace/` → `output/`) | 감사 추적과 부분 재실행의 근거 |
| Phase 2 팀 내부 | 메시지 + 태스크 | 실시간 조율이 필요 |
| QA 반려 | 메시지 — 담당자 직접 | 리드 경유는 왕복이 늘고 맥락이 손실된다 |

## 상태 관리

**전부 파일 기반.** 데이터베이스도 세션 상태도 없다. 세션이 끊겨도 `_workspace/`와 `output/`만 있으면 이어서 할 수 있다.

| 파일 | 역할 |
|------|------|
| `_workspace/01_brief.json` | 캠페인의 계약서. 팩트 원장이 여기 있다 |
| `_workspace/03_cards.html` | 카드 편집 소스. 부분 수정의 기준점 |
| `output/qa_report.md` | 발행 가부 판정 + 지적 이력 |
| `.claude/skills/sojourn-brand-system/references/boogie-usage.md` | 부기 라이선스 승인 상태 체크박스 |
| `CLAUDE.md` | 하네스 트리거 + 변경 이력 |

**`_workspace/`를 지우지 마라.** 사후 검증과 부분 재실행이 불가능해진다.

### 실행 모드 판별

오케스트레이터는 시작 시 세 갈래로 분기한다:

- `01_brief.json` 없음 → **초기 실행**
- 있음 + 부분 수정 요청 → **부분 재실행** (해당 에이전트만, 나머지 산출물 보존)
- 있음 + 새 소재 → **새 실행** (`_workspace_prev/`로 백업 후 처음부터)

이 판별을 건너뛰면 "3번 카드만 고쳐줘"에 전체를 갈아엎는다.
