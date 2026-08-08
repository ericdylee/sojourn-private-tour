import { h, clear, toast, fmtBytes, openLightbox } from '../ui.js'

/**
 * The photo library.
 *
 * Uploading and registering are one action, not two. `assets/photos/manifest.json`
 * is the ledger the card renderer checks, and a file that is not in it fails the
 * build — so a screen that only copied bytes into the repo would hand the user a
 * photo the pipeline refuses to use. Every field below exists because something
 * downstream reads it: `slot` decides whether AI generation is allowed at all,
 * `rights` is what puts a credit on the card, `subject` is how the next person
 * finds this picture again.
 */

const RIGHTS_PRESETS = [
  { label: '직접 촬영 (자사)', value: 'own' },
  { label: 'CC BY — 저작자 표기', value: 'licensed:wikimedia/CC BY 4.0 — ' },
  { label: 'CC0 / 퍼블릭 도메인', value: 'licensed:wikimedia/CC0 — ' },
  { label: '유료 스톡', value: 'licensed:stock/' },
]

export async function render(root, ctx) {
  const { api } = ctx
  const body = h('div', { class: 'body' })

  root.append(
    h(
      'div',
      { class: 'view' },
      h(
        'header',
        { class: 'head' },
        h('div', { class: 'head__kicker' }, 'assets/photos/manifest.json'),
        h('h1', { class: 'head__title' }, '사진'),
        h(
          'p',
          { class: 'head__sub' },
          '올리는 즉시 사진 원장에 등재됩니다. 등재되지 않은 이미지는 렌더러가 차단하므로, 업로드와 등재는 한 동작입니다. ',
          '자사 실사진은 라이선스 의무가 없어 카드·블로그에 가장 자유롭게 쓸 수 있습니다.',
        ),
      ),
      body,
    ),
  )

  let picked = null // { name, bytes, dataUrl, width, height }

  async function load() {
    clear(body).append(h('div', { class: 'empty' }, h('span', { class: 'spinner' }), ' 읽는 중…'))
    let data
    try {
      data = await api('/api/photos')
    } catch (err) {
      clear(body).append(h('div', { class: 'notice notice--bad' }, err.message))
      return
    }
    paint(data)
  }

  /**
   * `Element.append` is not the `h()` helper: handed a null it inserts the
   * literal text "null". Every optional child therefore has to be filtered out
   * before it reaches a native append.
   */
  function add(parent, ...nodes) {
    parent.append(...nodes.filter(Boolean))
    return parent
  }

  function paint(data, errors = null) {
    clear(body)
    add(body, uploadPanel(data, errors), libraryPanel(data), wantedPanel(data))
  }

  /* ---------- upload ---------- */

  function uploadPanel(data, errors) {
    const panel = h('div', { class: 'panel' })
    const fields = {}
    const previewBox = h('div', { class: 'photo-drop__preview' })

    const fileInput = h('input', {
      type: 'file',
      accept: 'image/jpeg,image/png,image/webp',
      style: { display: 'none' },
      onchange: (e) => e.target.files[0] && takeFile(e.target.files[0]),
    })

    const drop = h(
      'div',
      {
        class: 'photo-drop',
        tabindex: '0',
        role: 'button',
        onclick: () => fileInput.click(),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInput.click()
          }
        },
        ondragover: (e) => {
          e.preventDefault()
          drop.classList.add('is-over')
        },
        ondragleave: () => drop.classList.remove('is-over'),
        ondrop: (e) => {
          e.preventDefault()
          drop.classList.remove('is-over')
          const f = e.dataTransfer.files[0]
          if (f) takeFile(f)
        },
      },
      previewBox,
      fileInput,
    )

    function resetDropText() {
      clear(previewBox).append(
        h('div', { class: 'photo-drop__icon' }, '＋'),
        h('div', { class: 'photo-drop__text' }, '사진을 끌어다 놓거나 눌러서 고르세요'),
        h('div', { class: 'photo-drop__hint' }, 'jpg · png · webp, 최대 24MB'),
      )
    }

    function takeFile(file) {
      const reader = new FileReader()
      reader.onload = () => {
        const img = new Image()
        img.onload = () => {
          picked = {
            name: file.name,
            bytes: file.size,
            dataUrl: reader.result,
            width: img.naturalWidth,
            height: img.naturalHeight,
          }
          // Only fill the name if the user has not already typed one.
          if (!fields.filename.value.trim()) {
            fields.filename.value = file.name
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[^a-z0-9._-]/g, '')
          }
          paintPreview()
        }
        img.onerror = () => toast('이미지를 읽지 못했습니다', 'bad')
        img.src = reader.result
      }
      reader.onerror = () => toast('파일을 읽지 못했습니다', 'bad')
      reader.readAsDataURL(file)
    }

    function paintPreview() {
      clear(previewBox)
      const small = Math.min(picked.width, picked.height) < 1080
      previewBox.append(
        h('img', { class: 'photo-drop__img', src: picked.dataUrl, alt: '' }),
        h(
          'div',
          { class: 'photo-drop__facts' },
          h('span', null, `${picked.width}×${picked.height}`),
          h('span', null, fmtBytes(picked.bytes)),
          small
            ? h('span', { class: 'badge badge--warn' }, '1080 미만 — 카드에 쓰기 작습니다')
            : h('span', { class: 'badge badge--ok' }, '카드에 충분'),
        ),
      )
    }

    resetDropText()

    fields.filename = h('input', { type: 'text', placeholder: 'gamcheon-stairs.jpg' })
    fields.slot = h(
      'select',
      null,
      h('option', { value: 'place' }, 'place — 실제 방문 장소 (AI 생성 금지)'),
      h('option', { value: 'concept' }, 'concept — 개념·소품·질감 (AI 허용)'),
    )
    fields.subject = h('input', { type: 'text', placeholder: '무엇이 찍혀 있는지 한 줄로' })
    fields.rights = h('input', { type: 'text', placeholder: 'own / licensed:… — 저작자' })
    fields.shotAt = h('input', { type: 'text', placeholder: '2026-08-07 (선택)' })
    fields.note = h('textarea', { rows: '2', placeholder: '크롭·용도 등 메모 (선택)' })
    fields.ai = h('input', { type: 'checkbox' })

    const aiRow = h(
      'label',
      { class: 'photo-check' },
      fields.ai,
      h('span', null, 'AI로 생성한 이미지입니다'),
      h('span', { class: 'field__hint' }, 'place 슬롯에는 넣을 수 없습니다 (ADR-010)'),
    )

    const presets = h(
      'div',
      { class: 'presets' },
      RIGHTS_PRESETS.map((p) =>
        h(
          'button',
          {
            class: 'preset',
            type: 'button',
            onclick: () => {
              fields.rights.value = p.value
              fields.rights.focus()
            },
          },
          p.label,
        ),
      ),
    )

    const submit = h(
      'button',
      {
        class: 'btn btn--primary',
        onclick: async () => {
          if (!picked) return toast('먼저 사진을 고르세요', 'bad')
          submit.disabled = true
          submit.textContent = '올리는 중…'
          try {
            const saved = await api('/api/photos', {
              method: 'POST',
              body: JSON.stringify({
                filename: fields.filename.value.trim(),
                slot: fields.slot.value,
                subject: fields.subject.value.trim(),
                rights: fields.rights.value.trim(),
                shotAt: fields.shotAt.value.trim() || null,
                note: fields.note.value.trim() || null,
                aiGenerated: fields.ai.checked,
                dataBase64: picked.dataUrl,
              }),
            })
            picked = null
            toast(`${saved.displayPath} 등재 완료`, 'good')
            if (saved.smallForCards) {
              toast('가로·세로 중 짧은 쪽이 1080 미만입니다. 카드 배경으로는 작습니다.', 'bad')
            }
            await load()
          } catch (err) {
            submit.disabled = false
            submit.textContent = '올리고 원장에 등재'
            paint(data, { message: err.message, field: err.payload?.field || null })
          }
        },
      },
      '올리고 원장에 등재',
    )

    add(
      panel,
      h('h2', { class: 'panel__title' }, '사진 올리기'),
      errors ? h('div', { class: 'notice notice--bad' }, errors.message) : null,
      drop,
      h('div', { class: 'photo-form' },
        field('파일 이름', fields.filename, '영문 소문자·숫자·(. _ -)만. 확장자는 실제 형식과 같아야 합니다'),
        field('슬롯', fields.slot, '장소를 주장하는 사진이면 place'),
        field('무엇이 찍혔나', fields.subject, '원장에서 이 설명으로 사진을 찾습니다'),
        field('출처·권리', fields.rights, '카드·블로그의 크레딧 표기가 여기서 나옵니다'),
        field('촬영일', fields.shotAt, null),
        field('메모', fields.note, null),
      ),
      presets,
      aiRow,
      h('div', { class: 'btn-row' }, submit),
    )
    return panel
  }

  function field(label, control, hint) {
    return h(
      'div',
      { class: 'field' },
      h('label', { class: 'field__label' }, label),
      control,
      hint ? h('div', { class: 'field__hint' }, hint) : null,
    )
  }

  /* ---------- library ---------- */

  function libraryPanel(data) {
    const panel = h('div', { class: 'panel' })
    const photos = data.photos || []
    panel.append(
      h('h2', { class: 'panel__title' }, `원장에 등재된 사진 ${photos.length}장`),
    )
    if (!photos.length) {
      panel.append(h('div', { class: 'empty' }, '아직 없습니다.'))
      return panel
    }
    const grid = h('div', { class: 'photo-grid' })
    for (const p of photos) {
      const src = `/api/file?path=${encodeURIComponent(p.previewPath)}`
      grid.append(
        h(
          'figure',
          { class: 'photo-card' + (p.missing ? ' is-missing' : '') },
          p.missing
            ? h('div', { class: 'photo-card__gone' }, '파일 없음')
            : h('img', {
                class: 'photo-card__img',
                src,
                alt: p.subject || p.file,
                loading: 'lazy',
                onclick: () => openLightbox(src, `${p.file} — ${p.rights || ''}`),
              }),
          h(
            'figcaption',
            { class: 'photo-card__meta' },
            h('div', { class: 'photo-card__name' }, p.file),
            h('div', { class: 'photo-card__sub' }, p.subject || ''),
            h(
              'div',
              { class: 'photo-card__tags' },
              h('span', { class: 'badge' }, p.slot || '?'),
              p.ai_generated ? h('span', { class: 'badge badge--warn' }, 'AI') : null,
              h('span', { class: 'faint' }, licenceLabel(p.rights)),
              p.bytes ? h('span', { class: 'faint' }, fmtBytes(p.bytes)) : null,
            ),
          ),
        ),
      )
    }
    panel.append(grid)
    return panel
  }

  /**
   * Shorten `licensed:wikimedia/CC BY 4.0 — Someone` to `CC BY 4.0`. The tile is
   * a browsing aid; the full string stays in the manifest and on the card.
   */
  function licenceLabel(rights) {
    if (!rights) return '—'
    if (rights === 'own') return '자사'
    if (rights.startsWith('ai:')) return rights
    const m = /\/([^—]+)/.exec(rights)
    return (m ? m[1] : rights).trim()
  }

  /* ---------- wanted ---------- */

  function wantedPanel(data) {
    const wanted = data.wanted || []
    if (!wanted.length) return null
    const panel = h('div', { class: 'panel' })
    panel.append(
      h('h2', { class: 'panel__title' }, '촬영 요청 목록'),
      h('p', { class: 'field__hint' }, '원장이 필요하다고 적어둔 컷입니다. 이 중 하나를 찍어 올리면 해당 카드의 라이선스 제약이 사라집니다.'),
      h(
        'ul',
        { class: 'wanted' },
        wanted.map((w) =>
          h('li', null, typeof w === 'string' ? w : `${w.subject || w.file || ''} ${w.note ? '— ' + w.note : ''}`),
        ),
      ),
    )
    return panel
  }

  await load()
}
