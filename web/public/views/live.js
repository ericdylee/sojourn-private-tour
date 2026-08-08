import { h, $, clear, toast, fmtClock, fmtDur, fmtCost, laneColor, actorLabel } from '../ui.js'

const TOOL_CLASS = {
  Agent: 'tool-tag--task',
  Task: 'tool-tag--task',
  Bash: 'tool-tag--bash',
  Write: 'tool-tag--write',
  Edit: 'tool-tag--write',
}

const STATUS_LABEL = {
  running: '실행 중',
  starting: '시작 중',
  done: '완료',
  error: '오류',
  stopped: '중단됨',
  // Not '완료'. The run stopped short of the end and the agent's own closing
  // sentence will not say so.
  interrupted: '중단 후 종료',
}

export async function render(root, ctx) {
  const { state, actions, on } = ctx

  if (!state.run) {
    root.append(
      h(
        'div',
        { class: 'view' },
        h(
          'header',
          { class: 'head' },
          h('div', { class: 'head__kicker' }, '라이브'),
          h('h1', { class: 'head__title' }, '실행 중인 작업이 없습니다'),
          h('p', { class: 'head__sub' }, '실행 화면에서 에이전트를 골라 시작하세요.'),
        ),
        h(
          'div',
          { class: 'body' },
          h('a', { class: 'btn btn--primary', href: '#/launch' }, '실행 화면으로'),
        ),
      ),
    )
    return null
  }

  /* ---------- chrome ---------- */

  const statusEl = h('span', { class: 'status' })
  const elapsedEl = h('div', { class: 'stat__v' }, '—')
  const eventsEl = h('div', { class: 'stat__v' }, '0')
  const costEl = h('div', { class: 'stat__v' }, '—')
  const stopBtn = h(
    'button',
    { class: 'btn btn--danger btn--sm', type: 'button', onclick: onStop },
    '중단',
  )

  const runhead = h(
    'div',
    { class: 'runhead' },
    h(
      'div',
      { style: { minWidth: '0' } },
      h(
        'div',
        { class: 'head__kicker', style: { marginBottom: '4px' } },
        state.run.agent || '캠페인(레거시)',
        state.replay ? ' · 이력 재생' : '',
      ),
      h('h1', { class: 'runhead__title' }, state.run.title || state.run.id),
    ),
    h(
      'div',
      { class: 'runhead__right' },
      statusEl,
      // Cost and turn count only arrive with the final result message, so the
      // live figure is the event count — it moves, which is the point.
      h(
        'div',
        { class: 'runhead__stats' },
        h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, '경과'), elapsedEl),
        h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, '이벤트'), eventsEl),
        h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, '비용'), costEl),
      ),
      stopBtn,
    ),
  )

  const harnessEl = h('div', { class: 'harness' })
  const linkEl = h('div', { class: 'linkbar', hidden: true })
  const gatesEl = h('div', { class: 'gates' })
  const timelineEl = h('div', { class: 'timeline' })
  const lanesEl = h('div', { class: 'lanes' })
  const sideInfoEl = h('div', { class: 'kv' })

  const followBtn = h(
    'button',
    { class: 'btn btn--sm btn--ghost', type: 'button', onclick: () => setFollow(true) },
    '↓ 최신으로',
  )
  const followWrap = h('div', { class: 'follow' }, followBtn)

  root.append(
    h(
      'div',
      { class: 'view' },
      runhead,
      h(
        'div',
        { class: 'live' },
        // Gates first: an agent blocked on a human decision is the only thing
        // on this screen that is actually waiting on the reader.
        h('div', { class: 'live__main' }, linkEl, gatesEl, harnessEl, timelineEl, followWrap),
        h(
          'aside',
          { class: 'live__side' },
          h('h2', { class: 'sec' }, '에이전트 레인'),
          lanesEl,
          h('h2', { class: 'sec' }, '실행 정보'),
          sideInfoEl,
        ),
      ),
    ),
  )

  /* ---------- follow / autoscroll ---------- */

  const stage = $('#stage')
  let follow = true
  function setFollow(v) {
    follow = v
    followWrap.style.display = v ? 'none' : 'flex'
    if (v) stage.scrollTo({ top: stage.scrollHeight, behavior: 'smooth' })
  }
  const onScroll = () => {
    const nearBottom = stage.scrollHeight - stage.scrollTop - stage.clientHeight < 120
    if (!nearBottom && follow) setFollow(false)
    else if (nearBottom && !follow) setFollow(true)
  }
  stage.addEventListener('scroll', onScroll, { passive: true })
  setFollow(true)

  /* ---------- painters ---------- */

  function paintStatus() {
    const s = state.status || state.run.status || 'starting'
    statusEl.dataset.s = s
    statusEl.textContent = STATUS_LABEL[s] || s
    stopBtn.disabled = !(s === 'running' || s === 'starting') || state.replay
    stopBtn.style.visibility = stopBtn.disabled ? 'hidden' : 'visible'
    eventsEl.textContent = state.events.length
    costEl.textContent = state.costUsd ? fmtCost(state.costUsd) : '—'
  }

  /**
   * A live run whose feed has died looks exactly like a live run that has gone
   * quiet — same status pill, same frozen timeline. Say which one it is.
   */
  function paintLink() {
    if (state.replay || state.link !== 'retry') {
      linkEl.hidden = true
      return
    }
    linkEl.hidden = false
    clear(linkEl)
    linkEl.append(
      h('span', { class: 'spinner' }),
      h(
        'span',
        null,
        '연결이 끊겨 재연결 중입니다. 실행은 서버에서 계속되고 있고, 승인 요청이 있으면 다시 연결되는 즉시 뜹니다.',
      ),
    )
  }

  function paintElapsed() {
    const start = state.run.startedAt
    if (!start) return
    const end = ['done', 'error', 'stopped'].includes(state.status) ? state.run.endedAt || Date.now() : Date.now()
    elapsedEl.textContent = fmtDur(end - start)
  }

  function paintHarness() {
    clear(harnessEl)
    const hn = state.harness
    if (!hn) {
      harnessEl.append(
        h(
          'div',
          { class: 'harness__cell', style: { gridColumn: '1 / -1' } },
          h('div', { class: 'harness__k' }, '하네스'),
          h('div', { class: 'harness__v' }, h('span', { class: 'spinner' }), ' 세션 초기화 중…'),
        ),
      )
      return
    }
    // The number that matters is not "how many agents exist" but "did THIS
    // project's harness load". Everything else is CLI built-ins.
    const wantAgents = (state.meta?.agents || []).map((a) => a.id)
    const wantSkills = state.meta?.projectSkills || []
    const gotAgents = hn.agents || []
    const gotSkills = hn.skills || []
    const missingAgents = wantAgents.filter((a) => !gotAgents.includes(a))
    const missingSkills = wantSkills.filter((s) => !gotSkills.includes(s))
    const gate = (hn.mcpServers || []).find((s) => s.startsWith('gate:'))
    const gateOk = gate === 'gate:connected'

    const cell = (k, v, opts = {}) =>
      h(
        'div',
        { class: 'harness__cell', title: opts.title || '' },
        h('div', { class: 'harness__k' }, k),
        h('div', { class: `harness__v ${opts.bad ? 'is-bad' : ''}` }, v),
      )

    harnessEl.append(
      cell('모델', hn.model),
      cell(
        '프로젝트 에이전트',
        `${wantAgents.length - missingAgents.length} / ${wantAgents.length}`,
        {
          bad: missingAgents.length > 0,
          title: missingAgents.length ? `누락: ${missingAgents.join(', ')}` : `로드됨: ${wantAgents.join(', ')}`,
        },
      ),
      cell('프로젝트 스킬', `${wantSkills.length - missingSkills.length} / ${wantSkills.length}`, {
        bad: missingSkills.length > 0,
        title: missingSkills.length ? `누락: ${missingSkills.join(', ')}` : `로드됨: ${wantSkills.join(', ')}`,
      }),
      cell('승인 게이트', gateOk ? '연결됨' : gate || '없음', {
        bad: !gateOk,
        title: gateOk ? '' : '게이트가 붙지 않으면 에이전트가 사람에게 물을 수 없습니다.',
      }),
      cell('툴', `${hn.toolCount ?? 0}개`, {
        title: `MCP 서버 ${(hn.mcpServers || []).length}개: ${(hn.mcpServers || []).join(', ')}`,
      }),
    )
  }

  function paintGates() {
    clear(gatesEl)
    for (const gate of state.gates.values()) gatesEl.append(gateCard(gate))
  }

  /**
   * An approval card is the one thing on this screen that is waiting on the
   * reader, so its buttons have to be reachable without hunting for them.
   *
   * They were not. The agents write long justifications — the real one that
   * exposed this ran to about forty lines of context — and the card grew with
   * it, pushing 승인/반려 below the fold. The buttons did not look disabled or
   * missing; they looked like they did not exist.
   *
   * So the card is now a fixed-height column: the reasoning scrolls inside it,
   * the controls sit in a footer pinned to the bottom of the card. Long context
   * costs scrolling inside the card, never the ability to answer.
   */
  function gateCard(gate) {
    const kicker = { choice: '선택 필요', approval: '승인 필요', text: '입력 필요' }[gate.kind] || '응답 필요'
    const body = h('div', { class: 'gate__body' })
    const foot = h('div', { class: 'gate__foot' })
    const card = h(
      'div',
      { class: 'gate' },
      h('div', { class: 'gate__kicker' }, kicker),
      h('div', { class: 'gate__q' }, gate.question || gate.title || '(질문 없음)'),
      body,
      foot,
    )
    const ctx = gate.context || gate.detail
    if (ctx) body.append(h('div', { class: 'gate__ctx' }, ctx))

    const send = async (value) => {
      card.querySelectorAll('button, input').forEach((n) => (n.disabled = true))
      try {
        await actions.answerGate(gate.id, value)
      } catch (err) {
        toast(err.message, 'bad')
        // answerGate has already re-read the server's open gates; repaint so a
        // card for a gate that is gone does not sit there taking clicks.
        paintGates()
      }
    }

    if (gate.kind === 'choice') {
      const opts = h('div', { class: 'gate__opts' })
      ;(gate.options || []).forEach((opt, i) => {
        opts.append(
          h(
            'button',
            { class: 'gate__opt', type: 'button', onclick: () => send(opt) },
            h('span', { class: 'gate__opt-n' }, String(i + 1).padStart(2, '0')),
            h('span', null, opt),
          ),
        )
      })
      const free = h('input', { type: 'text', placeholder: '또는 직접 입력…' })
      free.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && free.value.trim()) send(free.value.trim())
      })
      foot.append(opts, h('div', { class: 'gate__free' }, free))
    } else if (gate.kind === 'approval') {
      const reason = h('input', { type: 'text', placeholder: '반려 사유 (반려할 때만)' })
      foot.append(
        h('div', { class: 'gate__free' }, reason),
        h(
          'div',
          { class: 'btn-row', style: { marginTop: '10px' } },
          h('button', { class: 'btn btn--primary', type: 'button', onclick: () => send('승인') }, '승인'),
          h(
            'button',
            {
              class: 'btn btn--danger',
              type: 'button',
              onclick: () => send(`반려: ${reason.value.trim() || '사유 미기재'}`),
            },
            '반려',
          ),
        ),
      )
    } else {
      const input = h('input', { type: 'text', placeholder: gate.placeholder || '응답을 입력하세요' })
      const submit = () => input.value.trim() && send(input.value.trim())
      input.addEventListener('keydown', (e) => e.key === 'Enter' && submit())
      foot.append(
        h('div', { class: 'gate__free' }, input),
        h(
          'div',
          { class: 'btn-row', style: { marginTop: '10px' } },
          h('button', { class: 'btn btn--primary', type: 'button', onclick: submit }, '보내기'),
        ),
      )
    }

    setTimeout(() => card.querySelector('input')?.focus(), 40)
    return card
  }

  function paintLanes() {
    clear(lanesEl)
    if (!state.lanes.size) {
      lanesEl.append(h('div', { class: 'empty', style: { padding: '18px' } }, '아직 없음'))
      return
    }
    const sorted = [...state.lanes.entries()].sort((a, b) => b[1] - a[1])
    for (const [actor, n] of sorted) {
      lanesEl.append(
        h(
          'div',
          { class: 'lane', style: { '--lane': laneColor(actor) } },
          h('span', { class: 'lane__chip' }),
          h('span', { class: 'lane__name' }, actorLabel(actor)),
          h('span', { class: 'lane__n' }, n),
        ),
      )
    }
  }

  function paintSide() {
    clear(sideInfoEl)
    const rows = [
      ['실행 ID', state.run.id],
      ['모드', state.run.agent || '캠페인(레거시)'],
      ['시작', state.run.startedAt ? new Date(state.run.startedAt).toLocaleString('ko-KR') : '—'],
      ['턴', state.numTurns ? String(state.numTurns) : '진행 중'],
      ['비용', state.costUsd ? fmtCost(state.costUsd) : '진행 중'],
    ]
    if (state.run.error) rows.push(['오류', state.run.error])
    for (const [k, v] of rows) {
      sideInfoEl.append(h('div', { class: 'kv__k' }, k), h('div', { class: 'kv__v' }, v))
    }
  }

  /* ---------- timeline ---------- */

  function eventNode(ev) {
    const lane = { '--lane': laneColor(ev.actor || 'lead') }
    const meta = (label) =>
      h(
        'div',
        { class: 'ev__meta' },
        h('span', { class: 'ev__actor' }, label ?? actorLabel(ev.actor || 'lead')),
        h('span', { class: 'ev__time' }, fmtClock(ev.t)),
      )

    switch (ev.type) {
      case 'run.started':
        return h(
          'div',
          { class: 'ev ev--sys', style: lane },
          meta('실행 시작'),
          h(
            'div',
            { class: 'ev__body' },
            ev.snapshot?.length ? `스냅샷 저장: ${ev.snapshot.join(', ')}` : '스냅샷 없음',
          ),
        )

      case 'session.init':
        return h(
          'div',
          { class: 'ev ev--sys', style: lane },
          meta('하네스'),
          h(
            'div',
            { class: 'ev__body' },
            `에이전트 ${ev.agents?.length ?? 0}인 · 스킬 ${ev.skills?.length ?? 0}개 로드됨`,
          ),
        )

      case 'agent.text':
        return h('div', { class: 'ev ev--text', style: lane }, meta(), h('div', { class: 'ev__text' }, ev.text))

      case 'agent.thinking':
        return h(
          'div',
          { class: 'ev ev--notice', style: lane },
          meta(),
          h('div', { class: 'ev__body thinking-dots' }, '생각하는 중'),
        )

      case 'tool.use':
        return h(
          'div',
          { class: 'ev ev--tool', style: lane },
          meta(),
          h(
            'div',
            { class: 'ev__body' },
            h('span', { class: `tool-tag ${TOOL_CLASS[ev.tool] || ''}` }, ev.tool),
            h('span', { class: 'tool-sum' }, ev.summary || ''),
          ),
        )

      case 'tool.result':
        if (!ev.preview) return null
        return h(
          'div',
          { class: `ev ev--result ${ev.ok ? '' : 'is-err'}`, style: lane },
          h('div', { class: 'ev__body' }, ev.preview),
        )

      case 'gate.open':
        return h(
          'div',
          { class: 'ev ev--gate', style: lane },
          meta('승인 요청'),
          h('div', { class: 'ev__body' }, ev.question || ev.title || ''),
        )

      case 'gate.answered':
        return h(
          'div',
          { class: 'ev ev--gate', style: lane },
          meta('사람 응답'),
          h('div', { class: 'ev__body' }, ev.value),
        )

      case 'notice':
        return h('div', { class: 'ev ev--notice', style: lane }, h('div', { class: 'ev__body' }, ev.text))

      case 'run.error':
        return h(
          'div',
          { class: 'ev ev--result is-err', style: lane },
          meta('오류'),
          h('div', { class: 'ev__body' }, ev.message),
        )

      case 'run.result':
        return ev.text
          ? h('div', { class: 'ev ev--text', style: lane }, meta('최종 보고'), h('div', { class: 'ev__text' }, ev.text))
          : null

      case 'run.ended':
        return h(
          'div',
          { class: `ev ev--end ${ev.status === 'interrupted' ? 'is-err' : ''}`, style: lane },
          h(
            'div',
            { class: 'ev__body' },
            `실행 종료 · ${STATUS_LABEL[ev.status] || ev.status} · ${fmtCost(ev.costUsd)}`,
          ),
          ev.status === 'interrupted' &&
            h(
              'div',
              { class: 'ev__body' },
              ev.interrupted?.tool
                ? `${ev.interrupted.tool} 호출이 중단된 뒤 종료됐다. 산출물이 미완일 수 있으니 파일을 직접 확인하라.`
                : '끝까지 가지 않고 종료됐다. 산출물이 미완일 수 있으니 파일을 직접 확인하라.',
            ),
        )

      case 'run.stopping':
        return h('div', { class: 'ev ev--notice', style: lane }, h('div', { class: 'ev__body' }, '중단 요청 전달됨…'))

      // tool.permission is bookkeeping — the tool.use row already says what ran.
      default:
        return null
    }
  }

  function appendEvent(ev) {
    const node = eventNode(ev)
    if (node) timelineEl.append(node)
  }

  function paintAll() {
    clear(timelineEl)
    for (const ev of state.events) appendEvent(ev)
    paintHarness()
    paintLink()
    paintGates()
    paintLanes()
    paintSide()
    paintStatus()
    paintElapsed()
  }

  async function onStop() {
    stopBtn.disabled = true
    try {
      await actions.stopRun()
    } catch (err) {
      toast(err.message, 'bad')
      stopBtn.disabled = false
    }
  }

  /* ---------- wiring ---------- */

  paintAll()

  const offEvent = on('event', (ev) => {
    appendEvent(ev)
    if (['session.init'].includes(ev.type)) paintHarness()
    if (['gate.open', 'gate.answered', 'run.ended'].includes(ev.type)) paintGates()
    if (ev.actor) paintLanes()
    paintStatus()
    paintSide()
    if (follow) stage.scrollTo({ top: stage.scrollHeight, behavior: 'auto' })
  })
  const offReset = on('run-reset', paintAll)
  const offLink = on('link', paintLink)
  // The server just told us what is actually open. That answer outranks
  // whatever the event stream left on screen.
  const offSynced = on('synced', () => {
    paintGates()
    paintStatus()
    paintLink()
  })

  const ticker = setInterval(paintElapsed, 1000)

  return {
    destroy() {
      offEvent()
      offReset()
      offLink()
      offSynced()
      clearInterval(ticker)
      stage.removeEventListener('scroll', onScroll)
    },
  }
}
