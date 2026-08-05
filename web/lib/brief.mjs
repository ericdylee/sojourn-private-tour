import fs from 'node:fs'
import path from 'node:path'
import { BRIEF_PATH, WEB_ROOT } from './paths.mjs'

/**
 * The fact ledger.
 *
 * Whatever sits in `facts` gets copied into cards, blog, SNS and reels. A wrong
 * number here becomes four wrong claims, and the tour is a real promise — so the
 * editor validates hard and refuses to write a malformed ledger.
 *
 * As of 2026-08-05 there is no `campaign-strategist` agent: **a human owns this
 * file.** Agents read it, cross-check against it, and report problems; only this
 * editor writes it. That is why creation lives here too.
 *
 * `landing` is not editable: the URL is QA-verified (200) and is a CRITICAL
 * project constant. `card_skeleton` and `seo` stay producer-owned.
 */

const EDITABLE = ['topic', 'angle', 'key_message', 'competitor_gap', 'note', 'facts', 'banned_extra']
const BACKUP_DIR = path.join(WEB_ROOT, '.brief-backups')

/** The landing page is a project constant, verified 200 on 2026-08-03. */
const LANDING = {
  url: 'https://www.sojournkorea.net/private-tour',
  status: '200',
  checked_at: '2026-08-03',
}

/**
 * A new campaign does not start blank. These entries are standing project rules
 * that QA paid for once — every one of them traces to a real defect. Starting
 * from zero would re-open the same holes on the next campaign.
 */
const STANDING_FACTS = [
  { claim: '요금', source: 'UNVERIFIED — 랜딩 페이지에 가격 표기 없음. 전 산출물에서 가격 언급 금지' },
  { claim: '코스별 정확한 소요 시간(시간 단위)', source: 'UNVERIFIED — full day / half day 구분만 확인됨' },
  { claim: '고객 후기', source: 'UNVERIFIED — 검증된 후기 없음. 후기 카드를 만들지 마라' },
]

const STANDING_BANNED = [
  '가격·요금 일체',
  '정확한 소요 시간 (예: 8시간)',
  '투어의 시작·종료 시각 (예: start at nine, or noon) — 랜딩에 시각 표기가 전무. QA B2로 확정. 고객 측 장면 묘사의 시각(예: 고객이 밤 11시에 일정을 짜는 장면)은 서비스 약속이 아니므로 대상 아님',
  '지어낸 고객 후기·평점',
  '혼잡도 주장 (예: before the crowds) — 검증 불가',
]

export function briefSeed() {
  return {
    campaign_id: '',
    topic: '',
    persona: 'visitor',
    angle: '',
    competitor_gap: '',
    key_message: '',
    note: '',
    landing: { ...LANDING },
    facts: STANDING_FACTS.map((f) => ({ ...f })),
    banned_extra: [...STANDING_BANNED],
  }
}

export function readBrief() {
  if (!fs.existsSync(BRIEF_PATH)) return { exists: false, editable: EDITABLE, seed: briefSeed() }
  try {
    const json = JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf8'))
    const s = fs.statSync(BRIEF_PATH)
    return {
      exists: true,
      mtime: s.mtimeMs,
      editable: EDITABLE,
      brief: json,
      unverified: (json.facts || []).filter((f) => /UNVERIFIED/i.test(f.source || '')).length,
    }
  } catch (err) {
    return { exists: true, error: `JSON 파싱 실패: ${err.message}` }
  }
}

/** @param {boolean} creating campaign_id is settable once, at creation. */
export function validatePatch(patch, creating = false) {
  const errors = []
  if (!patch || typeof patch !== 'object') return ['본문이 객체가 아닙니다']

  const allowed = creating ? [...EDITABLE, 'campaign_id', 'persona'] : EDITABLE
  for (const key of Object.keys(patch)) {
    if (!allowed.includes(key)) errors.push(`편집할 수 없는 필드입니다: ${key}`)
  }

  if (creating) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(patch.campaign_id || ''))) {
      errors.push('campaign_id 는 kebab-case 여야 합니다 (예: gamcheon-culture-village)')
    }
    if (!String(patch.topic || '').trim()) errors.push('소재(topic)를 입력하세요')
    if (patch.persona && !['visitor', 'expat', 'hr'].includes(patch.persona)) {
      errors.push('persona 는 visitor / expat / hr 중 하나여야 합니다')
    }
  }

  if ('facts' in patch) {
    if (!Array.isArray(patch.facts)) {
      errors.push('facts 는 배열이어야 합니다')
    } else {
      patch.facts.forEach((f, i) => {
        if (!f || typeof f !== 'object') return errors.push(`facts[${i}] 가 객체가 아닙니다`)
        if (typeof f.claim !== 'string' || !f.claim.trim()) errors.push(`facts[${i}].claim 이 비어 있습니다`)
        if (typeof f.source !== 'string' || !f.source.trim())
          errors.push(`facts[${i}].source 가 비어 있습니다 — 출처 없는 사실은 원장에 넣을 수 없습니다`)
      })
    }
  }

  if ('banned_extra' in patch) {
    if (!Array.isArray(patch.banned_extra)) {
      errors.push('banned_extra 는 배열이어야 합니다')
    } else if (patch.banned_extra.some((v) => typeof v !== 'string' || !v.trim())) {
      errors.push('banned_extra 의 각 항목은 비어 있지 않은 문자열이어야 합니다')
    }
  }

  for (const key of ['topic', 'angle', 'key_message', 'competitor_gap', 'note']) {
    if (key in patch && typeof patch[key] !== 'string') errors.push(`${key} 는 문자열이어야 합니다`)
  }

  return errors
}

function fail(errors) {
  const err = new Error(errors.join(' / '))
  err.validation = errors
  return err
}

function backup(current, stamp) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  fs.writeFileSync(path.join(BACKUP_DIR, `01_brief.${stamp}.json`), JSON.stringify(current, null, 2))
}

function commit(next) {
  const tmp = BRIEF_PATH + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, BRIEF_PATH)
}

/** Create the ledger from scratch. Refuses to clobber an existing one. */
export function createBrief(patch) {
  const errors = validatePatch(patch, true)
  if (errors.length) throw fail(errors)
  if (fs.existsSync(BRIEF_PATH)) {
    throw new Error('브리프가 이미 있습니다. 새로 만들려면 기존 파일을 먼저 옮기세요.')
  }
  fs.mkdirSync(path.dirname(BRIEF_PATH), { recursive: true })
  const next = { ...briefSeed(), ...patch, landing: { ...LANDING } }
  commit(next)
  return { ok: true, created: true, brief: next }
}

export function writeBrief(patch) {
  const errors = validatePatch(patch)
  if (errors.length) throw fail(errors)
  if (!fs.existsSync(BRIEF_PATH)) {
    throw new Error('브리프가 없습니다. 브리프 화면에서 먼저 새로 만드세요.')
  }

  const current = JSON.parse(fs.readFileSync(BRIEF_PATH, 'utf8'))
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  backup(current, stamp)
  const next = { ...current, ...patch }
  commit(next)

  return { ok: true, backup: `01_brief.${stamp}.json`, brief: next }
}
