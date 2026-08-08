/**
 * Agent catalogue and trigger prompts.
 *
 * The console runs one agent at a time. It owns no campaign logic — brand
 * system, fact ledger, Boogie licensing, render QA all live in
 * `.claude/skills/` and `.claude/agents/`, loaded verbatim via
 * `settingSources: ['project']`. These strings only pull the right trigger.
 *
 * `presets` are starting points for the instruction box, grounded in the
 * pending work in docs/PRD.md. They are editable text, not fixed commands.
 */

export const AGENTS = [
  {
    id: 'card-producer',
    label: '카드뉴스',
    phase: '제작',
    blurb: '1080×1080 영문 6장. HTML/CSS 조판 + Playwright 렌더 + 자동 검사',
    output: 'output/cards/01~06.png',
    placeholder: '예: 3번 카드 서브카피만 고쳐서 다시 렌더해라.',
    presets: [
      {
        label: '감천문화마을 편 6장',
        text: '감천문화마을 편 카드뉴스 6장을 제작하라.\n\n기존 output/cards/ 를 덮어쓰기 전에 반드시 게이트로 승인을 받아라.\n렌더 후 자동 검사(규격·오버플로우·락업충돌·대비·줄수)를 통과시키고, 남은 지적사항을 그대로 보고하라.',
      },
      {
        label: '특정 카드만 재렌더',
        text: '3번 카드의 서브카피만 고치고 그 카드만 다시 렌더하라. 나머지 5장은 건드리지 마라.\n\n바꿀 문구는 먼저 게이트로 후보를 제시하고 고르게 하라.',
      },
      {
        label: '전체 재렌더',
        text: '_workspace/03_cards.html 을 그대로 두고 output/cards/ 6장을 다시 렌더한 뒤, 자동 검사 결과를 보고하라.',
      },
    ],
  },
  {
    id: 'blog-writer',
    label: '블로그',
    phase: '제작',
    blurb: '영문 3,000자. 한 편 = 한 장소 매거진 기사체. 메타·FAQ 스키마 포함',
    output: 'output/blog.md',
    placeholder: '예: 자갈치시장 편을 감천 편과 같은 형식으로 써라.',
    presets: [
      {
        label: '자갈치시장 편',
        text: '자갈치시장 편을 써라.\n\n형식 원본은 사이트 레포의 2026-08-04-gamcheon-culture-village.md 다 —\n도입 훅 → 역사 → 볼 것 → 가는 법 → 언제 갈까 → How we help, 소제목마다 사진 1장.\n장소 사실은 출처를 표기하고, 서비스 사실은 브리프 원장에서만 가져와라.\n사진이 없으면 자리만 표시하고 무엇이 필요한지 적어라.',
      },
      {
        label: '다음 장소 편 제안',
        text: '다음 블로그 편으로 쓸 장소 후보를 게이트로 물어라.\n\n대기 목록: 자갈치시장 / 흰여울문화마을 / 해운대·스카이캡슐 / 태종대·송도.\n고른 장소로 글을 쓰되, 사진 확보 여부를 먼저 확인하고 없으면 알려라.',
      },
    ],
  },
  {
    id: 'social-writer',
    label: 'SNS',
    phase: '제작',
    blurb: 'Threads / LinkedIn / X 각 500자. 채널별로 각도를 다르게',
    output: 'output/social.json',
    placeholder: '예: 링크드인만 다시 써라. 지금 버전이 채용 공고처럼 읽힌다.',
    presets: [
      {
        label: '3채널 새로 쓰기',
        text: '현재 브리프와 output/blog.md 를 읽고 Threads·LinkedIn·X 3편을 새로 써라.\n\n세 편이 같은 문장을 쓰지 않게 각도를 나눠라 — 장면 / 문제 / 결과.\n각 500자 이내, X는 스레드로 쪼개되 각 트윗 280자 이내.',
      },
      {
        label: '한 채널만 수정',
        text: '링크드인 포스팅만 다시 써라. 나머지 두 채널은 건드리지 마라.\n\n지금 버전의 문제가 무엇인지 먼저 진단하고, 고칠 방향을 게이트로 확인한 뒤 작업하라.',
      },
    ],
  },
  {
    id: 'brand-qa',
    label: '브랜드 QA',
    phase: '검수',
    blurb: '렌더 PNG 직접 열람 + 팩트 원장 대조 + 규격 검증 → PASS/HOLD',
    output: 'output/qa_report.md',
    placeholder: '예: 현재 output/ 전체를 재검수하고 판정을 내려라.',
    presets: [
      {
        label: '전체 재검수',
        text: '현재 output/ 전체를 검수하고 PASS/HOLD를 판정하라.\n\n카드 PNG 6장을 Read로 직접 열어 확인하고, 모든 사실 주장을 _workspace/01_brief.json 의 facts 원장과 대조하라.\n이미지 속에 읽히는 시각·가격·인원수도 문장과 동일한 주장으로 취급하라 (ADR-013).\n결과를 output/qa_report.md 에 쓰기 전에 게이트로 판정을 확인받아라.',
      },
      {
        label: '카드만 검수',
        text: 'output/cards/ 6장만 검수하라. 블로그와 SNS는 이번 검수 대상이 아니다.\n\n규격(1080×1080)·세이프에어리어·대비·액센트 1종 15% 상한·페이저 일관성을 픽셀로 실측하고,\n카피의 사실 주장을 원장과 대조하라. 리포트 파일은 쓰지 말고 화면에만 보고하라.',
      },
      {
        label: '팩트 원장 감사',
        text: '_workspace/01_brief.json 의 facts 원장을 감사하라.\n\n각 사실의 source 가 실제로 그 claim 을 뒷받침하는지 확인하라. 랜딩 페이지를 직접 열어 대조해도 좋다.\n근거가 약하거나 낡은 항목, UNVERIFIED로 표시돼야 하는데 확정처럼 적힌 항목을 지적하라.\nbanned_extra 에 등재돼야 하는데 빠진 것이 있으면 함께 지적하라.\n\n**원장 파일은 절대 고치지 마라.** 무엇을 어떻게 바꿔야 하는지만 보고하면 사람이 브리프 화면에서 반영한다.',
      },
    ],
  },
  {
    id: 'reels-producer',
    label: '릴스',
    phase: '릴스',
    blurb: '9:16 인스타 릴스. 씬 구성표 승인 후 HTML 재조판 + 결정론적 렌더 (크레딧 0)',
    output: 'output/reels/',
    placeholder: '예: 씬 구성표까지만 만들고 승인을 받아라. 조판·렌더는 아직 하지 마라.',
    presets: [
      {
        label: '씬 구성표만',
        text: '_workspace/03_cards.html에서 카피를 축자 인용해 씬 4~5개를 골라 04_reel_plan.json을 만들어라.\n(`_workspace/02_carousel.json`은 QA 3회차 교정을 승계하지 못해 낡았다 — 카피 출처로 쓰지 마라.)\n\n이 원장 자체가 승인용 씬 구성표다 — 별도 scene_plan.md를 만들지 말고 04_reel_plan.json으로 승인을 받아라.\n승인 후 9:16 조판(04_reel.html)을 하고 각 씬 첫 프레임으로 크롭을 한 번 더 확인받은 뒤 render-reel.mjs를 돌려라.\n\n크레딧을 쓰지 않는다 — 영상 생성 모델을 부르지 마라.\nQA PASS는 발행 조건이지 착수 조건이 아니다 — 판정이 HOLD여도 제작을 진행하라.\nQA가 PASS가 아니면 reel_INTERNAL.mp4가 나오는 것이 정상이다. 게이트를 우회하지 마라.',
      },
    ],
  },
]

export function agentPrompt({ agent, instruction }) {
  const meta = AGENTS.find((a) => a.id === agent)
  const label = meta ? `${meta.label} (${agent})` : agent
  return [
    `Task 툴로 \`${agent}\` 서브에이전트를 \`model: "opus"\` 로 호출해 아래 작업을 맡겨라.`,
    '너는 직접 작업하지 말고 위임한 뒤, 결과를 사람이 읽을 수 있게 요약해 보고하라.',
    '',
    `**담당:** ${label}`,
    meta ? `**주 산출물:** ${meta.output}` : '',
    '',
    '**지시:**',
    instruction,
    '',
    '기존 산출물을 덮어쓰거나 이동하기 전에는 반드시 `mcp__gate__ask_approval` 로 승인을 받아라 — 되돌리기 어려운 작업이다.',
    '서브에이전트가 사람의 결정을 필요로 하면 게이트 툴을 쓰도록 지시에 포함시켜라.',
  ]
    .filter(Boolean)
    .join('\n')
}
