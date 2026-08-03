---
name: social-posts
description: Threads·LinkedIn·X 3개 채널용 영문 500자 포스팅을 채널별 톤과 규격에 맞춰 각각 다르게 작성한다. 같은 캠페인 메시지를 채널 문법에 맞게 변주하고 해시태그·링크·훅을 채널별로 최적화한다. "SNS 글 써줘", "스레드 링크드인 X 포스팅", "소셜 카피", "500자 포스팅", "링크드인만 다시", "X용으로 짧게" 같은 요청에 반드시 트리거하라. 기존 포스팅 수정·채널 추가·부분 재작성 요청에도 트리거하라.
---

# Social Posts — Threads / LinkedIn / X

같은 캠페인 메시지를 **세 번 다르게** 쓴다. 한 번 써서 세 곳에 복붙하는 것이 이 스킬이 막으려는 실패다 — 세 채널은 독자도 문법도 다르다.

## 먼저 읽어라

1. `.claude/skills/sojourn-brand-system/SKILL.md` — 톤, 금지 표현, 채널 규격
2. `_workspace/01_brief.json` — 앵글, 페르소나, key_message, CTA, **facts 원장**
3. `output/social.json` (있으면) — 재실행 시 기존 원고 기반 개선

## 공통 규칙

- **영문 단독.** 세 채널 모두 500자 이내(공백 포함).
- 세 편 모두 브리프의 `key_message`를 담되, **같은 문장을 쓰지 마라.**
- 브리프 `facts`에 없는 숫자를 쓰지 마라.
- 첫 줄이 전부를 결정한다. 세 채널 모두 미리보기에서 1~2줄만 보인다.

## 채널별 문법

### Threads
- **1인칭 캐주얼.** 브랜드 계정이지만 사람이 쓴 것처럼. "We provide" ✗ → "I drove a family to Gamcheon at 9am yesterday" ○
- 짧은 문단, 줄바꿈 자주. 통짜 문단 금지.
- 해시태그 **0~2개**. 많으면 광고로 읽혀 도달이 죽는다.
- 링크는 본문에 넣지 말고 댓글로 유도하거나 마지막 줄에 한 번.
- 관찰이나 장면으로 시작하라. 주장으로 시작하면 스크롤된다.

### LinkedIn
- **B2B·주재원 앵글.** 페르소나가 `visitor`라도 LinkedIn 버전만은 `expat`/`hr` 관점으로 다시 틀어라. 이유: LinkedIn 독자는 여행자가 아니라 부임·재배치를 다루는 사람이다.
- 첫 줄 훅 → 빈 줄 → 맥락 2~3문단(각 1~2문장) → 빈 줄 → CTA.
- 문단 사이 **빈 줄 필수.** LinkedIn은 통짜 문단을 접어버린다.
- 해시태그 **3~5개**, 맨 아래. 예: `#Busan #ExpatLife #RelocationSupport #KoreaTravel`
- 이모지 0~1개. 과하면 신뢰형 톤과 충돌한다.

### X
- **첫 문장이 훅.** 나머지가 안 읽혀도 성립하는 한 문장으로 시작하라.
- 500자면 단일 포스트로 길다 → 훅 포스트 + 후속 2~3개 **스레드로 분할**하고 `thread` 배열로 출력하라.
- 해시태그 0~2개. X에서는 해시태그가 도달을 거의 안 올린다.
- 링크는 마지막 포스트에.

## 워크플로우

1. 브리프의 `key_message`를 세 가지 각도로 재진술한다 (장면 / 문제 / 결과).
2. 각 채널에 각도 하나씩 배정한다 — 보통 Threads=장면, LinkedIn=문제, X=결과.
3. 작성 후 **글자 수를 실제로 세어라.** 눈대중으로 500자를 넘기면 플랫폼에서 잘린다.
4. 세 편을 나란히 읽고 같은 문장이 없는지 확인한다.

## 출력 — `output/social.json`

```json
{
  "campaign_id": "",
  "key_message": "",
  "posts": {
    "threads":  { "text": "", "char_count": 0, "hashtags": [], "angle": "scene" },
    "linkedin": { "text": "", "char_count": 0, "hashtags": [], "angle": "problem" },
    "x":        { "thread": ["", ""], "char_count": 0, "hashtags": [], "angle": "outcome" }
  },
  "link": "https://sojournkorea.net/private-tour"
}
```

완료 보고: 채널별 글자 수 · 각 채널에 쓴 각도 · 중복 문장 없음 확인.

## 하지 마라

- 세 채널에 같은 글을 복붙하지 마라. 이유: 알고리즘이 아니라 사람이 알아본다. 브랜드가 게을러 보인다.
- LinkedIn을 여행 후기 톤으로 쓰지 마라. 독자가 다르다.
- 해시태그를 채널 권장 개수 이상 붙이지 마라. 도달이 떨어진다.
- `facts`에 없는 가격·소요시간을 쓰지 마라. SNS는 수정해도 캡처가 남는다.
