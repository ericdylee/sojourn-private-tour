import { h, clear, md, fmtBytes, fmtDateTime, openLightbox, toast } from '../ui.js'

const fileUrl = (rel) => `/api/file?path=${encodeURIComponent(rel)}`

export async function render(root, ctx) {
  const { api } = ctx
  const body = h('div', { class: 'body' })

  const refreshBtn = h('button', { class: 'btn btn--sm', type: 'button', onclick: load }, '다시 읽기')

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
            h('div', { class: 'head__kicker' }, 'output/ · _workspace/'),
            h('h1', { class: 'head__title' }, '산출물'),
            h(
              'p',
              { class: 'head__sub' },
              '파일 시스템이 단일 출처입니다. 이 화면은 별도 DB 없이 레포를 그대로 읽습니다.',
            ),
          ),
          refreshBtn,
        ),
      ),
      body,
    ),
  )

  async function load() {
    clear(body).append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 읽는 중…'))
    let data
    try {
      data = await api('/api/artifacts')
    } catch (err) {
      clear(body).append(h('div', { class: 'notice notice--bad' }, err.message))
      return
    }
    clear(body)

    /* ---------- cards ---------- */
    const cards = data.cards || []
    body.append(
      h(
        'h2',
        { class: 'sec' },
        '카드뉴스',
        h('span', { class: 'count' }, cards.length ? `${cards.length}장 · 1080×1080` : '없음'),
      ),
    )
    if (!cards.length) {
      body.append(h('div', { class: 'empty' }, 'output/cards/ 에 PNG가 없습니다.'))
    } else {
      const grid = h('div', { class: 'cards-grid' })
      cards.forEach((c, i) => {
        const dims = c.dims ? `${c.dims.w}×${c.dims.h}` : '크기 불명'
        grid.append(
          h(
            'button',
            {
              class: 'cardtile',
              type: 'button',
              style: { animationDelay: `${i * 45}ms` },
              onclick: () => openLightbox(fileUrl(c.rel), `${c.name} · ${dims}`),
            },
            h('img', { src: fileUrl(c.rel), alt: c.name, loading: 'lazy' }),
            h(
              'div',
              { class: 'cardtile__bar' },
              h('span', { class: 'cardtile__name' }, c.name),
              h('span', { class: `cardtile__dims ${c.spec === false ? 'is-bad' : ''}` }, dims),
            ),
          ),
        )
      })
      body.append(grid)
      const offSpec = cards.filter((c) => c.spec === false)
      if (offSpec.length) {
        body.append(
          h(
            'div',
            { class: 'notice notice--bad' },
            `규격 이탈 ${offSpec.length}장: ${offSpec.map((c) => c.name).join(', ')} — 1080×1080이 아닙니다.`,
          ),
        )
      }
    }

    /* ---------- QA ---------- */
    const qa = data.qa
    body.append(h('h2', { class: 'sec' }, '브랜드 QA', qa?.verdict && h('span', { class: 'count' }, qa.verdict)))
    if (!qa) {
      body.append(h('div', { class: 'empty' }, 'output/qa_report.md 가 없습니다.'))
    } else {
      body.append(
        h(
          'div',
          { class: `verdict ${qa.verdict === 'PASS' ? 'verdict--pass' : 'verdict--hold'}` },
          h('span', { class: 'verdict__mark' }, qa.verdict || '?'),
          h(
            'div',
            { class: 'verdict__counts' },
            h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, 'Blocker'), h('div', { class: 'stat__v' }, qa.blocker ?? '—')),
            h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, 'Major'), h('div', { class: 'stat__v' }, qa.major ?? '—')),
            h('div', { class: 'stat' }, h('div', { class: 'stat__k' }, 'Minor'), h('div', { class: 'stat__v' }, qa.minor ?? '—')),
          ),
          h('div', { class: 'faint', style: { marginLeft: 'auto', fontSize: '11px' } }, fmtDateTime(qa.mtime)),
        ),
        details('리포트 전문', h('div', { class: 'md', html: md(qa.text) })),
      )
    }

    /* ---------- social ---------- */
    const social = data.social
    body.append(h('h2', { class: 'sec' }, 'SNS', h('span', { class: 'count' }, '채널당 500자 규격')))
    if (!social) {
      body.append(h('div', { class: 'empty' }, 'output/social.json 이 없습니다.'))
    } else if (social.error) {
      body.append(h('div', { class: 'notice notice--bad' }, social.error))
    } else {
      const grid = h('div', { class: 'social-grid' })
      for (const p of social.posts) {
        const pct = Math.min(100, Math.round((p.chars / p.limit) * 100))
        const cls = p.chars > p.limit ? 'is-over' : pct > 88 ? 'is-warn' : ''
        const textNode = p.threadParts
          ? h(
              'div',
              { class: 'post__text' },
              p.threadParts.map((t, i) =>
                h(
                  'div',
                  { class: 'post__tweet' },
                  h('span', { class: 'post__tweet-n' }, `${i + 1}/${p.threadParts.length} · ${t.chars}자${t.over ? ' — 280 초과' : ''}`),
                  t.text,
                ),
              ),
            )
          : h('div', { class: 'post__text' }, p.text)

        grid.append(
          h(
            'div',
            { class: 'post' },
            h(
              'div',
              { class: 'post__top' },
              h('span', { class: 'post__ch' }, p.channel),
              p.angle && h('span', { class: 'badge' }, p.angle),
            ),
            textNode,
            h('div', { class: 'meter' }, h('div', { class: `meter__fill ${cls}`, style: { width: `${pct}%` } })),
            h(
              'div',
              { class: 'post__count' },
              h('span', null, `${p.chars} / ${p.limit}자`),
              h('span', null, (p.hashtags || []).join(' ')),
            ),
          ),
        )
      }
      body.append(grid)
    }

    /* ---------- blog ---------- */
    const blog = data.blog
    body.append(
      h('h2', { class: 'sec' }, '블로그', blog && h('span', { class: 'count' }, `${blog.charCount.toLocaleString()}자 · ${blog.wordCount.toLocaleString()}단어`)),
    )
    if (!blog) {
      body.append(h('div', { class: 'empty' }, 'output/blog.md 가 없습니다.'))
    } else {
      const kv = h('div', { class: 'kv' })
      for (const key of ['title', 'meta_description', 'primary_keyword', 'slug', 'canonical', 'campaign_id']) {
        if (blog.meta[key]) kv.append(h('div', { class: 'kv__k' }, key), h('div', { class: 'kv__v' }, blog.meta[key]))
      }
      body.append(kv, details('본문', h('div', { class: 'md', html: md(blog.body) })))
    }

    /* ---------- workspace ---------- */
    const ws = data.workspace || []
    body.append(h('h2', { class: 'sec' }, '워크스페이스', h('span', { class: 'count' }, `${ws.length}개`)))
    if (!ws.length) {
      body.append(h('div', { class: 'empty' }, '_workspace/ 가 비어 있습니다.'))
    } else {
      const list = h('div', { class: 'filelist' })
      for (const f of ws) {
        list.append(
          h(
            'div',
            { class: 'filerow' },
            h('span', { class: 'filerow__name' }, f.name),
            h('span', { class: 'filerow__meta' }, fmtBytes(f.size)),
            h('span', { class: 'filerow__meta' }, fmtDateTime(f.mtime)),
            h(
              'a',
              { class: 'btn btn--sm btn--ghost', href: fileUrl(f.rel), target: '_blank', rel: 'noreferrer' },
              '열기',
            ),
          ),
        )
      }
      body.append(list)
    }

    toast(`산출물 ${cards.length}장 · ${ws.length}개 파일을 읽었습니다`)
  }

  function details(summaryText, node) {
    const d = h('details', { class: 'panel', style: { marginBottom: '28px' } })
    const s = h('summary', {
      style: {
        cursor: 'pointer',
        fontSize: '11px',
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--fg-dim)',
      },
    })
    s.textContent = summaryText
    d.append(s, h('div', { style: { marginTop: '18px' } }, node))
    return d
  }

  await load()
  return null
}
