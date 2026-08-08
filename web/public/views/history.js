import { h, clear, toast, fmtDateTime, fmtDur, fmtCost } from '../ui.js'

// 'interrupted' is not '완료'. A run that lost a tool call mid-flight ends with
// the agent writing a tidy closing sentence and the SDK reporting success; the
// list is where someone scanning past runs would otherwise never learn better.
const STATUS_LABEL = {
  running: '실행 중',
  starting: '시작 중',
  done: '완료',
  error: '오류',
  stopped: '중단',
  interrupted: '중단 후 종료',
}

export async function render(root, ctx) {
  const { api, actions } = ctx
  const body = h('div', { class: 'body' })

  root.append(
    h(
      'div',
      { class: 'view' },
      h(
        'header',
        { class: 'head' },
        h(
          'div',
          { class: 'head__row' },
          h(
            'div',
            null,
            h('div', { class: 'head__kicker' }, 'web/.runs/'),
            h('h1', { class: 'head__title' }, '실행 이력'),
            h(
              'p',
              { class: 'head__sub' },
              '각 실행은 이벤트 로그와 실행 직전 스냅샷을 함께 보관합니다. 결과가 나쁘면 스냅샷으로 되돌릴 수 있습니다.',
            ),
          ),
          h('button', { class: 'btn btn--sm', type: 'button', onclick: load }, '다시 읽기'),
        ),
      ),
      body,
    ),
  )

  async function load() {
    clear(body).append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 읽는 중…'))
    let runs
    try {
      ;({ runs } = await api('/api/runs'))
    } catch (err) {
      clear(body).append(h('div', { class: 'notice notice--bad' }, err.message))
      return
    }
    clear(body)

    if (!runs.length) {
      body.append(h('div', { class: 'empty' }, '아직 실행 기록이 없습니다.'))
      return
    }

    const list = h('div', { class: 'runs' })
    for (const r of runs) {
      list.append(
        h(
          'button',
          {
            class: 'runrow',
            type: 'button',
            onclick: () => open(r),
          },
          h('span', { class: 'runrow__dot', 'data-s': r.status }),
          h(
            'span',
            { class: 'runrow__title' },
            r.title || r.id,
            h('span', { class: 'faint', style: { marginLeft: '10px', fontSize: '11px' } }, fmtDateTime(r.startedAt)),
          ),
          h('span', { class: 'runrow__mode' }, r.agent || '캠페인(레거시)'),
          h('span', { class: 'runrow__num' }, r.endedAt ? fmtDur(r.endedAt - r.startedAt) : '—'),
          h('span', { class: 'runrow__num' }, r.costUsd ? fmtCost(r.costUsd) : '—'),
        ),
      )
    }
    body.append(list)

    body.append(
      h('h2', { class: 'sec', style: { marginTop: '34px' } }, '스냅샷 복원'),
      h(
        'p',
        { class: 'faint', style: { fontSize: '11.5px', marginBottom: '14px', maxWidth: '70ch', lineHeight: '1.7' } },
        '선택한 실행이 시작되기 직전 상태로 ',
        h('code', null, 'output/'),
        ' 과 ',
        h('code', null, '_workspace/'),
        ' 를 통째로 되돌립니다. 그 이후의 모든 변경은 사라집니다.',
      ),
    )

    const select = h(
      'select',
      { style: { maxWidth: '640px' } },
      runs.map((r) =>
        h('option', { value: r.id }, `${fmtDateTime(r.startedAt)} · ${STATUS_LABEL[r.status] || r.status} · ${r.title || r.id}`),
      ),
    )
    body.append(
      h(
        'div',
        { class: 'btn-row' },
        select,
        h(
          'button',
          {
            class: 'btn btn--danger',
            type: 'button',
            onclick: async () => {
              const id = select.value
              const row = runs.find((r) => r.id === id)
              if (!confirm(`정말 되돌립니까?\n\n${row?.title || id}\n실행 직전 상태로 output/ 과 _workspace/ 를 덮어씁니다.`)) return
              try {
                const res = await api(`/api/runs/${encodeURIComponent(id)}/restore`, { method: 'POST' })
                toast(`복원 완료: ${res.restored.join(', ')}`, 'good')
              } catch (err) {
                toast(err.message, 'bad')
              }
            },
          },
          '이 시점으로 되돌리기',
        ),
      ),
    )
  }

  async function open(run) {
    try {
      await actions.openRun(run.id, { replay: run.status !== 'running' && run.status !== 'starting' })
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  await load()
  return null
}
