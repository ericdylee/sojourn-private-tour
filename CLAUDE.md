# 프로젝트: Sojourn Korea — 부산 프라이빗 투어 마케팅

sojournkorea.net의 `/private-tour` 랜딩으로 트래픽과 예약 문의를 만드는 콘텐츠 생산 저장소.
코드 제품이 아니라 **마케팅 산출물**(카드뉴스·블로그·SNS·릴스)이 결과물이다.

## 캠페인 고정 조건

- 대상: **부산** 프라이빗 투어 (서울은 후순위)
- 콘텐츠 언어: **영어 단독** — 사이트가 전면 영문이라 랜딩 경험과 끊기면 안 된다
- 블로그: 자사 사이트 게재, **구글 SEO**, 3,000자(영문 공백 포함) 내외
- 카드뉴스: **1080×1080 × 6장**
- SNS: Threads / LinkedIn / X 각 500자
- 랜딩: **`https://www.sojournkorea.net/private-tour`** (`www.` 포함. apex는 308 리다이렉트)
- 마스코트: 부기(Boogi). 저작권자 부산광역시. **공공누리 제4유형 — 상업적 이용·변형 금지, 서면 승인 필수**

## 하네스: 부산 투어 마케팅

**목표:** 브리프 하나에서 카드뉴스 6장 · 블로그 · SNS 3편 · 릴스를 일관된 메시지로 생산한다.

**세션 시작 시:** `docs/PRD.md`의 "현재 상태" 절을 먼저 읽어라. 진행 상황·다음 작업·대기 중인 사용자 액션·제약이 거기 있다.

**트리거:** 캠페인 제작·수정·재실행 요청 시 `busan-campaign` 스킬을 사용하라. 산출물 하나만 필요하면 해당 전용 스킬(`cardnews-render`, `longform-blog`, `social-posts`, `brand-qa-check`, `reels-produce`)로 바로 가도 된다. 브랜드 규칙 질문은 `sojourn-brand-system`. 단순 질문은 직접 응답 가능.

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-08-03 | 초기 구성 — 에이전트 6 + 스킬 8 (브랜드 시스템 + 오케스트레이터 포함) | 전체 | - |
| 2026-08-03 | 랜딩 URL을 `/tour.html`로 확정, 가격 언급 금지 규칙 추가 | brand-system, campaign-brief, brand-qa-check, campaign-strategist | `/private-tour` 404 확인 · 랜딩에 가격 표기 없음 |
| 2026-08-03 | 부기 라이선스 상태 기록 (부산 소재 소상공인 = 무료 대상, 승인 신청 예정) | brand-system/references | 사용자 확인 |
| 2026-08-03 | 부기 가이드라인 전면 재작성 — 공공누리 4유형, 반전·왜곡·AI생성 금지, 저작권 표기 필수, 공식 응용동작 카탈로그 | brand-system, cardnews-render, brand-qa-check, reels-produce, busan-campaign, card-producer, reels-producer | 부산시 공식 가이드북 2종 입수. 기존 규칙 다수가 부정확했음 |
| 2026-08-03 | 렌더러에 부기 라이선스 자동 검사 추가 (반전·비율왜곡·크레딧 누락) | cardnews-render/scripts | 사람이 눈으로 놓치는 위반을 기계가 막는다 |
| 2026-08-03 | 랜딩 URL을 `www.sojournkorea.net/private-tour`로 확정 | brand-system, campaign-brief, brand-qa-check, campaign-strategist | 사용자가 페이지 경로 변경 완료 |
| 2026-08-03 | 첫 캠페인 세트 생산 (부기 미등장 6장) + `.no-char`·`.with-head` 아키타입 변형 추가 | _workspace, output/cards, cardnews-render/assets | 라이선스 승인 전 카피·레이아웃 방향 검증 |
| 2026-08-03 | docs 4종(PRD·ARCHITECTURE·ADR·UI_GUIDE) 템플릿 → 실제 내용으로 작성 | docs/ | 기획 내용이 대화에만 있어 새 세션에서 유실됨 |
| 2026-08-03 | 사진 파이프라인 추가 — 매니페스트 원장 + `.photo-*` 트리트먼트 + 렌더 출처 검증. ADR-010(장소 AI 금지)·011(OpenAI 미도입) | assets/photos, cardnews-render, brand-system, UI_GUIDE, ADR | 카드에 이미지가 0장이라 레퍼런스 대비 빈약. 장소 이미지 AI 생성은 약속 허위표시 위험 |
| 2026-08-03 | 촬영 리스트 작성 (우선순위 A/B/C) | docs/SHOTLIST.md | 실사진이 유일한 차별 자산 |

## CRITICAL 규칙

- CRITICAL: 프로젝트 **루트에 package.json을 만들지 마라.** 이유: `.claude/settings.json`의 Stop 훅이 루트 package.json을 감지하면 존재하지 않는 `npm run lint/build/test`를 매 턴 실행해 실패한다. 렌더 의존성은 `.claude/skills/cardnews-render/scripts/`에 격리한다.
- CRITICAL: 브리프 `facts` 원장에 없는 가격·소요시간·운영시간을 산출물에 쓰지 마라. 투어는 실제 이행 약속이라 틀리면 환불·분쟁 사유다.
- CRITICAL: 부기 라이선스가 승인완료가 아니면 대외 발행하지 마라. 내부 시안까지만 허용.
- CRITICAL: 부기를 **AI로 생성·변형하지 마라.** 좌우 반전·비율 왜곡·색 변경·새 포즈/표정/의상 생성 전부 금지다. 배경 제거와 업스케일만 허용. 등장 카드마다 저작권 표기 필수. 전체 규정은 `.claude/skills/sojourn-brand-system/references/boogie-usage.md`.
- `_workspace/`를 지우지 마라. 사후 검증과 부분 재실행의 근거다.

## 디렉토리

```
references/          원본 참고 자산 (boogie.jpeg, reference1/2.jpeg, 부기 공식 가이드북 PDF 2종)
assets/boogie/       부기 누끼 PNG (1회 준비)
_workspace/          중간 산출물 — 보존
output/              최종 산출물
.claude/agents/      에이전트 6인
.claude/skills/      스킬 8개
```
