import { h, $, clear, toast, laneColor } from '../ui.js'

/**
 * One agent, one instruction, one run.
 *
 * The console does not orchestrate the full campaign. Chaining is the
 * operator's call — run the strategist, read the brief, then run the producer.
 * The `busan-campaign` orchestrator is still in the harness if an instruction
 * asks for it; it just isn't a button that spends an hour unattended.
 */
export async function render(root, ctx) {
  const { state, actions } = ctx
  const agents = state.meta?.agents || []

  let agentId = agents[0]?.id || null
  let busy = false

  const head = h(
    'header',
    { class: 'head' },
    h(
      'div',
      { class: 'head__row' },
      h(
        'div',
        null,
        h('div', { class: 'head__kicker' }, 'Sojourn Korea · 부산 프라이빗 투어'),
        h('h1', { class: 'head__title' }, '캠페인 콘솔'),
        h(
          'p',
          { class: 'head__sub' },
          '에이전트 한 명에게 한 가지를 시킵니다. 규칙은 콘솔이 갖고 있지 않습니다 — ',
          h('code', null, '.claude/agents/'),
          ' 5인과 ',
          h('code', null, '.claude/skills/'),
          ' 8개를 터미널 세션과 동일하게 로드해 실행합니다.',
        ),
      ),
      h('div', { class: 'badge' }, state.meta?.model || '—'),
    ),
  )

  const body = h('div', { class: 'body' })
  root.append(h('div', { class: 'view' }, head, body))

  function paint() {
    clear(body)

    if (actions.isBusy()) {
      body.append(
        h(
          'div',
          { class: 'notice' },
          '이미 실행 중입니다. 두 실행이 같은 ',
          h('code', null, '_workspace/'),
          ' 와 ',
          h('code', null, 'output/'),
          ' 을 동시에 밟으면 팩트 원장과 산출물이 깨지므로 한 번에 하나만 돌립니다. ',
          h('a', { href: '#/live', style: { color: 'var(--blue-lift)' } }, '진행 상황 보기 →'),
        ),
      )
    }

    // ---- agent picker ----
    const grid = h('div', { class: 'agents' })
    for (const a of agents) {
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: `agent ${agentId === a.id ? 'is-on' : ''}`,
            style: { '--lane': laneColor(a.id) },
            onclick: () => {
              agentId = a.id
              paint()
            },
          },
          h(
            'div',
            { class: 'agent__top' },
            h('span', { class: 'agent__name' }, a.label),
            h('span', { class: 'agent__phase' }, a.phase),
          ),
          h('div', { class: 'agent__blurb' }, a.blurb),
          h('div', { class: 'agent__out' }, a.output),
        ),
      )
    }
    body.append(h('h2', { class: 'sec' }, '에이전트', h('span', { class: 'count' }, `${agents.length}인 중 1인`)), grid)

    // ---- instruction ----
    const picked = agents.find((a) => a.id === agentId)
    if (!picked) {
      body.append(h('div', { class: 'empty' }, '에이전트를 불러오지 못했습니다.'))
      return
    }

    const ta = h('textarea', { id: 'instruction', rows: 7, placeholder: picked.placeholder || '' })

    const presetRow = h('div', { class: 'presets' })
    for (const preset of picked.presets || []) {
      presetRow.append(
        h(
          'button',
          {
            type: 'button',
            class: 'preset',
            title: preset.text,
            onclick: () => {
              ta.value = preset.text
              ta.focus()
              ta.setSelectionRange(ta.value.length, ta.value.length)
            },
          },
          preset.label,
        ),
      )
    }
    presetRow.append(
      h(
        'button',
        { type: 'button', class: 'preset preset--clear', onclick: () => { ta.value = ''; ta.focus() } },
        '비우기',
      ),
    )

    body.append(
      h(
        'h2',
        { class: 'sec', style: { marginTop: '30px' } },
        '지시',
        h('span', { class: 'count' }, picked.label),
      ),
      picked.presets?.length ? presetRow : null,
      h(
        'label',
        { class: 'field' },
        ta,
        h(
          'span',
          { class: 'field__hint' },
          '리드가 Task 툴로 ',
          h('code', null, picked.id),
          ' 에게 위임하고 결과를 요약해 보고합니다. 사람 판단이 필요한 지점은 라이브 화면에 승인 카드로 뜹니다.',
        ),
      ),
    )

    // ---- launch ----
    const runBtn = h(
      'button',
      {
        class: 'btn btn--primary btn--lg',
        type: 'button',
        disabled: busy || actions.isBusy(),
        onclick: submit,
      },
      busy ? '시작하는 중…' : `${picked.label} 실행`,
    )

    body.append(
      h(
        'div',
        { class: 'launch-bar' },
        runBtn,
        h(
          'span',
          { class: 'faint', style: { fontSize: '11px', maxWidth: '52ch', lineHeight: '1.6' } },
          '실행 직전 ',
          h('code', null, 'output/'),
          ' 과 ',
          h('code', null, '_workspace/'),
          ' 를 스냅샷으로 떠둡니다. 결과가 나쁘면 이력 화면에서 되돌릴 수 있습니다.',
        ),
      ),
    )

    // Cmd/Ctrl+Enter runs — this box gets long instructions.
    ta.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
    })
  }

  async function submit() {
    const instruction = $('#instruction', body)?.value.trim()
    if (!instruction) return toast('지시 내용을 입력하세요', 'bad')
    busy = true
    paint()
    try {
      await actions.startRun({ agent: agentId, instruction })
    } catch (err) {
      toast(err.message, 'bad')
      busy = false
      paint()
    }
  }

  paint()
}
