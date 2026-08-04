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

**세션 시작 시:** `docs/PRD.md`의 "현재 상태" 절을 먼저 읽고, 그 안의 "다음 작업" 인용 블록에 적힌 항목을 **사용자에게 먼저 알려라.** 진행 상황·다음 작업·대기 중인 사용자 액션·제약이 전부 거기 있다.

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
| 2026-08-03 | 렌더러에 **외관 검사 2종 추가** — 줄수(allowlist·Range 기반) + 대비(글자 제거 스크린샷 픽셀 측정). NOTES/ISSUES 분리. ADR-014 | cardnews-render/scripts, SKILL, ADR | QA T1. 기존 검사가 전부 기하·메타데이터라 줄바꿈과 대비를 구조적으로 못 잡았고, 두 건(카드 06 URL 단어중간 줄바꿈 · 카드 02 흰글자 on 흰배경)이 exit 0을 통과했다 |
| 2026-08-03 | 카드 06에 페이저 `06 / 06` 추가 | _workspace/03_cards.html, output/cards | QA m5. 6장 중 5장만 인덱스가 있어 규칙이 아니라 누락으로 읽혔다 |
| 2026-08-03 | **부기 캐릭터 사용 보류 확정** — 캐릭터 없이 간다 | 전체 | 사용자 결정. 라이선스 승인 절차·고해상도 원본 확보 부담 대비 실익이 낮음 |
| 2026-08-03 | 블로그 1편 + SNS 3편 생산 | output/blog.md, output/social.json | 카드에 이어 나머지 채널 착수 |
| 2026-08-03 | 카드 03 "Start at nine. Or noon." 제거 → "You set the order." | _workspace/01_brief.json, 03_cards.html, output/cards | QA B2. 랜딩에 시각 표기가 전무한데 브리프가 운영시간을 주장했다. 브리프 원장 오류였음 |
| 2026-08-03 | 브리프 `banned_extra`에 "투어의 시작·종료 시각" 추가 | _workspace/01_brief.json | 원장을 안 고치면 다음 실행에서 같은 문구가 재생성된다 |
| 2026-08-03 | 카드 액센트 1종·15% 상한 위반 교정, 카드 02 페이저 소실 복구, 카드 06 CTA 크롭가드 이탈 | cardnews-render/assets/brand.css, output/cards | QA MAJOR 4건. 수정이 공용 CSS에 들어가 이후 전 세트에 적용된다 |
| 2026-08-03 | QA 수정분 실측 검증 — 6장 전부 단일 액센트·15% 이하(04: sand 7.89 단독, 06: coral 8.69 단독) | output/cards | 육안이 아니라 픽셀로 확인. **재검수는 아직 안 돌았다 — 공식 판정은 여전히 HOLD** |
| 2026-08-03 | 개념 이미지 생성에 Codex 빌트인 `gpt-image-2` 도입. ADR-012가 ADR-011을 대체 | ADR, PRD, assets/photos | API 키·과금·코드 추가 없이 셸 호출로 되고, Higgsfield 잔액 8크레딧을 릴스용으로 아낀다 |
| 2026-08-03 | 카드 03에 개념 이미지(바늘 없는 시계) 추가 | _workspace/03_cards.html, assets/photos | 카드 06장 중 이미지가 1장뿐이라 빈약했다 |
| 2026-08-03 | **ADR-013 신설 — 이미지도 원장에 없는 사실을 주장 금지.** QA에 A12 항목 추가 | ADR, brand-qa-check | 생성된 시계가 지시하지 않은 9시 10분을 그려, 문장으로 지운 운영시간 주장(B2)이 그림으로 되살아났다. ADR-010(장소)만으로는 못 잡는다 |

| 2026-08-04 | **블로그 첫 편 발행 — 라이브.** 사이트 레포 `~/PROJECTS/sojourn-relocation-v1`에 커밋·푸시 | 사이트 레포 | 사용자가 `/blog` 섹션 신설·배포 완료 |
| 2026-08-04 | 블로그 생성기에 `faq:` 프론트매터 → FAQPage 구조화 데이터 지원 (테스트 7종) | 사이트 레포 `scripts/publish.js` | 생성기가 Article만 내보내 FAQ 리치결과를 못 받았다. 답변이 본문에 없으면 빌드가 실패한다 |

| 2026-08-04 | 블로그 히어로 이미지 제작 — 개념 이미지(추상 루트 라인 + 새벽→밤 그래디언트) | assets/photos, 사이트 레포 | 히어로가 없어 og:image가 로고로 나갔다. 실제 장소 AI 생성은 ADR-010으로 금지라 논지를 그리는 도식으로 갔다 |

| 2026-08-04 | **블로그 형식 전환 — 한 편 = 한 장소, 매거진 기사체.** 첫 글·추상 히어로 폐기, 옛 URL은 301 | 사이트 레포 | 첫 글은 물류를 논증했을 뿐 장소를 묘사하지 않았다. 사람들이 검색하는 건 동선 최적화가 아니라 장소 이름이다 |
| 2026-08-04 | 장소 사진은 **실사진·라이선스 사진**으로 간다. ADR-010은 AI 생성 금지이지 실사진 금지가 아니었다 | assets/photos, manifest | 제약을 과하게 읽고 추상 도식으로 우회했던 것을 바로잡음 |
| 2026-08-04 | 팩트 규칙 2분화 — **장소 사실은 출처 표기, 서비스 사실은 원장** | 전체 | 매거진 기사에는 장소의 역사·주소·개장시간이 필요한데 원장에는 없다. 성격이 다른 사실이다 |
| 2026-08-04 | 블로그 본문 figure/figcaption 지원 추가 | 사이트 레포 templates/_head.html | CC 라이선스는 사진마다 출처 표기가 의무다 |

| 2026-08-04 | 블로그 제목에 `\|` 브레이크 마커 도입 — h1만 적용, lg(1024px) 이상에서만. 테스트 8종 | 사이트 레포 scripts/publish.js | `text-balance`가 "Haedong Yonggungsa: The / Temple..."로 의미를 끊었다. md에서 강제하면 마지막 단어가 고아가 돼 lg로 올렸다 |

## CRITICAL 규칙

- CRITICAL: 프로젝트 **루트에 package.json을 만들지 마라.** 이유: `.claude/settings.json`의 Stop 훅이 루트 package.json을 감지하면 존재하지 않는 `npm run lint/build/test`를 매 턴 실행해 실패한다. 렌더 의존성은 `.claude/skills/cardnews-render/scripts/`에 격리한다.
- CRITICAL: 브리프 `facts` 원장에 없는 가격·소요시간·운영시간을 산출물에 쓰지 마라. 투어는 실제 이행 약속이라 틀리면 환불·분쟁 사유다. **이건 글자만의 규칙이 아니다** — 이미지 속에 읽히는 시계 시각·가격표·인원수·간판 문구도 똑같은 주장이다(ADR-013). 생성 모델은 지시하지 않은 구체값을 스스로 채워 넣으므로, 개념 이미지라도 채택 전에 눈으로 확인하라.
- **부기 캐릭터는 현재 사용 보류다 (2026-08-03 사용자 결정).** 산출물에 넣지 마라. 아래 두 규칙은 보류가 해제될 경우에 대비해 남겨둔다.
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
