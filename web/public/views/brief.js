import { h, clear, toast, fmtDateTime } from '../ui.js'

/**
 * The fact ledger editor.
 *
 * Everything typed here is copied verbatim into cards, blog, SNS and reels, and
 * the tour is a real promise — so an empty source is treated as an error, not a
 * warning, and the landing URL is shown read-only.
 */
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
        h('div', { class: 'head__kicker' }, '_workspace/01_brief.json'),
        h('h1', { class: 'head__title' }, '브리프 · 팩트 원장'),
        h(
          'p',
          { class: 'head__sub' },
          '여기 적힌 사실이 카드·블로그·SNS·릴스 네 곳에 그대로 복제됩니다. 확인 못 한 값은 지어내지 말고 출처에 ',
          h('code', null, 'UNVERIFIED'),
          ' 라고 쓰면 뒤 단계가 사용하지 않습니다.',
        ),
      ),
      body,
    ),
  )

  let data = null
  let draft = null

  async function load() {
    clear(body).append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 읽는 중…'))
    try {
      data = await api('/api/brief')
    } catch (err) {
      clear(body).append(h('div', { class: 'notice notice--bad' }, err.message))
      return
    }
    if (!data.exists) return paintCreate()
    if (data.error) {
      clear(body).append(h('div', { class: 'notice notice--bad' }, data.error))
      return
    }
    draft = {
      topic: data.brief.topic || '',
      angle: data.brief.angle || '',
      key_message: data.brief.key_message || '',
      competitor_gap: data.brief.competitor_gap || '',
      note: data.brief.note || '',
      facts: (data.brief.facts || []).map((f) => ({ ...f })),
      banned_extra: [...(data.brief.banned_extra || [])],
    }
    paint()
  }

  /**
   * There is no strategist agent to author the first ledger, so creation lives
   * here. The seed already carries the standing prohibitions QA paid for — a
   * new campaign should not re-open holes that were already closed once.
   */
  function paintCreate(errors = null) {
    clear(body)
    const seed = data.seed || {}

    if (errors?.length) {
      body.append(
        h(
          'div',
          { class: 'errors' },
          h('strong', null, '만들지 않았습니다 — 검증 실패'),
          h('ul', null, errors.map((e) => h('li', null, e))),
        ),
      )
    }

    const idInput = h('input', { type: 'text', id: 'new-id', placeholder: 'gamcheon-culture-village' })
    const topicInput = h('textarea', { id: 'new-topic', rows: 2, placeholder: '예: 감천문화마을 — 색으로 뒤덮인 산비탈 마을을 반나절에 제대로 보는 법' })
    const personaSel = h(
      'select',
      { id: 'new-persona' },
      h('option', { value: 'visitor' }, 'visitor — 부산 방문 외국인 개인/가족'),
      h('option', { value: 'expat' }, 'expat — 한국 거주 주재원·유학생·은퇴자'),
      h('option', { value: 'hr' }, 'hr — 기업 HR·주재원 재배치 담당'),
    )
    const msgInput = h('textarea', { id: 'new-msg', rows: 2, placeholder: '모든 채널이 공유하는 영문 한 문장' })

    body.append(
      h(
        'div',
        { class: 'notice notice--info' },
        '브리프가 아직 없습니다. ',
        h('strong', null, '이 원장은 사람이 소유합니다'),
        ' — 이걸 대신 써주는 에이전트는 없습니다. 에이전트는 읽고 대조하고 지적할 뿐입니다.',
      ),
      h('h2', { class: 'sec' }, '새 원장 만들기'),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, '캠페인 ID'),
        idInput,
        h('span', { class: 'field__hint' }, 'kebab-case. 산출물과 이력에서 이 캠페인을 식별합니다.'),
      ),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, '소재'), topicInput),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, '타겟 페르소나'),
        personaSel,
        h('span', { class: 'field__hint' }, '하나만 고릅니다. 둘 이상을 노리면 카피가 전부 평균값이 됩니다.'),
      ),
      h(
        'label',
        { class: 'field' },
        h('span', { class: 'field__label' }, '핵심 메시지 (선택)'),
        msgInput,
        h('span', { class: 'field__hint' }, '나중에 채워도 됩니다. 만든 뒤 이 화면에서 계속 편집합니다.'),
      ),
      h(
        'div',
        { class: 'notice' },
        `함께 등재됩니다 — 표준 UNVERIFIED 사실 ${(seed.facts || []).length}건(요금·소요시간·후기)과 금지 표현 ${(seed.banned_extra || []).length}건. ` +
          '전부 QA가 실제로 잡았던 사고의 재발 방지책이라 새 캠페인도 이걸 갖고 시작합니다. 만든 뒤 지울 수 있습니다.',
      ),
      h(
        'div',
        { class: 'launch-bar' },
        h(
          'button',
          {
            class: 'btn btn--primary btn--lg',
            type: 'button',
            disabled: actions.isBusy(),
            onclick: async () => {
              try {
                await api('/api/brief', {
                  method: 'POST',
                  body: JSON.stringify({
                    campaign_id: idInput.value.trim(),
                    topic: topicInput.value.trim(),
                    persona: personaSel.value,
                    key_message: msgInput.value.trim(),
                  }),
                })
                toast('원장을 만들었습니다', 'good')
                await load()
              } catch (err) {
                paintCreate(err.payload?.validation || [err.message])
              }
            },
          },
          '원장 만들기',
        ),
        h(
          'span',
          { class: 'faint', style: { fontSize: '11px' } },
          '랜딩 URL은 QA 검증된 고정값으로 자동 등재됩니다.',
        ),
      ),
    )
  }

  function textField(key, label, hint, rows = 2) {
    const ta = h('textarea', { rows, value: draft[key] })
    ta.value = draft[key]
    ta.addEventListener('input', () => (draft[key] = ta.value))
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field__label' }, label),
      ta,
      hint && h('span', { class: 'field__hint' }, hint),
    )
  }

  function paint(errors = null) {
    clear(body)

    if (actions.isBusy()) {
      body.append(
        h(
          'div',
          { class: 'notice notice--bad' },
          '실행 중에는 원장을 수정할 수 없습니다. 에이전트가 같은 파일을 읽고 있습니다.',
        ),
      )
    }

    if (errors?.length) {
      body.append(
        h(
          'div',
          { class: 'errors' },
          h('strong', null, '저장하지 않았습니다 — 검증 실패'),
          h('ul', null, errors.map((e) => h('li', null, e))),
        ),
      )
    }

    /* ---------- fixed constants ---------- */
    const landing = data.brief.landing || {}
    body.append(
      h('h2', { class: 'sec' }, '고정 조건', h('span', { class: 'count' }, '읽기 전용')),
      h(
        'div',
        { class: 'kv' },
        h('div', { class: 'kv__k' }, '캠페인 ID'),
        h('div', { class: 'kv__v' }, data.brief.campaign_id || '—'),
        h('div', { class: 'kv__k' }, '랜딩 URL'),
        h(
          'div',
          { class: 'kv__v' },
          h('a', { href: landing.url, target: '_blank', rel: 'noreferrer', style: { color: 'var(--blue-lift)' } }, landing.url || '—'),
          ' ',
          landing.status === '200' && h('span', { class: 'badge badge--ok' }, `HTTP ${landing.status}`),
          landing.checked_at && h('span', { class: 'faint', style: { marginLeft: '8px' } }, `확인 ${landing.checked_at}`),
        ),
        h('div', { class: 'kv__k' }, '수정 시각'),
        h('div', { class: 'kv__v' }, fmtDateTime(data.mtime)),
      ),
    )

    /* ---------- message ---------- */
    body.append(
      h('h2', { class: 'sec' }, '메시지'),
      textField('topic', '소재', null, 2),
      textField('key_message', '핵심 메시지', '카드·블로그·SNS가 공유하는 한 문장', 2),
      textField('angle', '훅 앵글', null, 3),
      textField('competitor_gap', '경쟁 대안이 못 하는 것', null, 3),
      textField('note', '비고', null, 2),
    )

    /* ---------- facts ---------- */
    const unverified = draft.facts.filter((f) => /UNVERIFIED/i.test(f.source || '')).length
    body.append(
      h(
        'h2',
        { class: 'sec' },
        '팩트 원장',
        h('span', { class: 'count' }, `${draft.facts.length}건${unverified ? ` · UNVERIFIED ${unverified}` : ''}`),
      ),
      h('div', { class: 'facts__head' }, h('span', null, '주장'), h('span', null, '출처'), h('span', null, '')),
    )

    const facts = h('div', { class: 'facts' })
    draft.facts.forEach((fact, idx) => {
      const isUnverified = /UNVERIFIED/i.test(fact.source || '')
      const claim = h('textarea', { rows: 2, placeholder: '무엇을 주장하는가' })
      claim.value = fact.claim || ''
      claim.addEventListener('input', () => (fact.claim = claim.value))

      const source = h('textarea', { rows: 2, placeholder: '어디서 확인했는가 (확인 못 했으면 UNVERIFIED)' })
      source.value = fact.source || ''
      source.addEventListener('input', () => {
        fact.source = source.value
        row.classList.toggle('is-unverified', /UNVERIFIED/i.test(source.value))
      })

      const row = h(
        'div',
        { class: `fact ${isUnverified ? 'is-unverified' : ''}` },
        h('div', { class: 'fact__cell' }, claim),
        h('div', { class: 'fact__cell' }, source),
        h(
          'button',
          {
            class: 'fact__del',
            type: 'button',
            title: '이 사실 삭제',
            onclick: () => {
              draft.facts.splice(idx, 1)
              paint()
            },
          },
          '✕',
        ),
      )
      facts.append(row)
    })
    body.append(
      facts,
      h(
        'div',
        { class: 'btn-row', style: { marginBottom: '30px' } },
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              draft.facts.push({ claim: '', source: '' })
              paint()
            },
          },
          '+ 사실 추가',
        ),
      ),
    )

    /* ---------- banned ---------- */
    body.append(
      h('h2', { class: 'sec' }, '금지 표현', h('span', { class: 'count' }, `${draft.banned_extra.length}건`)),
      h(
        'p',
        { class: 'faint', style: { marginBottom: '12px', fontSize: '11.5px' } },
        '원장을 안 고치면 다음 실행에서 같은 문구가 다시 생성됩니다. 지운 문구는 여기에 등록하세요.',
      ),
    )
    const chips = h('div', { class: 'chips' })
    draft.banned_extra.forEach((val, idx) => {
      const input = h('input', { type: 'text' })
      input.value = val
      input.addEventListener('input', () => (draft.banned_extra[idx] = input.value))
      chips.append(
        h(
          'div',
          { class: 'chip' },
          input,
          h(
            'button',
            {
              type: 'button',
              title: '삭제',
              onclick: () => {
                draft.banned_extra.splice(idx, 1)
                paint()
              },
            },
            '✕',
          ),
        ),
      )
    })
    body.append(
      chips,
      h(
        'div',
        { class: 'btn-row' },
        h(
          'button',
          {
            class: 'btn btn--sm',
            type: 'button',
            onclick: () => {
              draft.banned_extra.push('')
              paint()
            },
          },
          '+ 금지 표현 추가',
        ),
      ),
    )

    /* ---------- save ---------- */
    const saveBtn = h('button', { class: 'btn btn--primary', type: 'button', onclick: save, disabled: actions.isBusy() }, '원장 저장')
    body.append(
      h(
        'div',
        { class: 'savebar' },
        saveBtn,
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: load }, '되돌리기'),
        h(
          'span',
          { class: 'faint', style: { fontSize: '11px' } },
          '저장 시 이전 버전은 web/.brief-backups/ 에 자동 보관됩니다.',
        ),
      ),
    )
  }

  async function save() {
    // Local check first so obvious mistakes never reach the API.
    const local = []
    draft.facts.forEach((f, i) => {
      if (!f.claim?.trim()) local.push(`${i + 1}번 사실의 주장이 비어 있습니다`)
      if (!f.source?.trim()) local.push(`${i + 1}번 사실의 출처가 비어 있습니다`)
    })
    if (draft.banned_extra.some((v) => !v.trim())) local.push('빈 금지 표현이 있습니다')
    if (local.length) return paint(local)

    try {
      const res = await api('/api/brief', { method: 'PUT', body: JSON.stringify(draft) })
      toast(`원장을 저장했습니다 (백업: ${res.backup})`, 'good')
      await load()
    } catch (err) {
      paint(err.payload?.validation || [err.message])
    }
  }

  await load()
  return null
}
