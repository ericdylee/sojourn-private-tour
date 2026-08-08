import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The three console defects that only ever showed up in real use were all in
 * this seam — the browser's picture of a run drifting from the server's — and
 * none of them could be caught by testing either side alone. So this drives the
 * real `public/app.js` in a real browser, with the transport faked so a stream
 * can be dropped on command.
 *
 * Playwright lives in the render skill, not here; the console has no browser
 * dependency of its own and should not grow one just for this. If it cannot be
 * resolved the file skips rather than fails — a missing dev tool is not a
 * regression.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const RENDER_SCRIPTS = path.resolve(HERE, '../../.claude/skills/cardnews-render/scripts')

let chromium = null
try {
  chromium = createRequire(path.join(RENDER_SCRIPTS, 'package.json'))('playwright').chromium
} catch {
  /* skipped below */
}

const RUN_ID = 'reconnect-test-run'
const openGate = {
  id: 'gate-abc',
  kind: 'approval',
  question: '카드 06을 이 문구로 확정할까요?',
  detail: '되돌릴 수 있습니다.',
}
const EVENTS = [
  { seq: 1, t: 1, type: 'run.started', agent: 'card-producer', instruction: '테스트', snapshot: [] },
  { seq: 2, t: 2, type: 'session.init', model: 'm', agents: [], skills: [], mcpServers: ['gate:connected'], toolCount: 1 },
  { seq: 3, t: 3, type: 'agent.text', actor: 'lead', text: '검토했습니다.' },
  { seq: 4, t: 4, type: 'gate.open', ...openGate },
]

async function freePort() {
  return new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

let proc = null
let base = null
let browser = null

before(async () => {
  if (!chromium) return
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  proc = spawn(process.execPath, [path.resolve(HERE, '../server.mjs')], {
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  })
  // Wait for the port to answer rather than sleeping a guessed interval.
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/api/meta`)
      if (r.ok) break
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
  proc?.kill()
})

/** A page wired to a fake EventSource we can feed and drop from the test. */
async function makePage({ gateWaiting = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.addInitScript(() => {
    window.__sockets = []
    class FakeES {
      constructor(url) {
        this.url = url
        window.__sockets.push(this)
        setTimeout(() => this.onopen?.({}), 5)
      }
      close() {}
    }
    window.EventSource = FakeES
    window.__feed = (evs) => {
      const es = window.__sockets[window.__sockets.length - 1]
      for (const ev of evs) es.onmessage?.({ data: JSON.stringify(ev) })
    }
    window.__drop = () => window.__sockets[window.__sockets.length - 1].onerror?.({})
  })

  const activeRun = {
    id: RUN_ID,
    mode: 'agent',
    agent: 'card-producer',
    instruction: '테스트',
    title: 'card-producer — 테스트',
    model: 'm',
    status: 'running',
    startedAt: 1,
    endedAt: null,
    error: null,
    costUsd: 0,
    numTurns: 0,
    harness: null,
    interrupted: null,
    resultSubtype: null,
    openGates: gateWaiting ? [openGate] : [],
  }
  const json = (route, body) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/state', (r) => json(r, { activeRun }))
  await page.route(`**/api/runs/${RUN_ID}`, (r) => json(r, { meta: activeRun, events: [] }))

  return { page, errors }
}

const probe = (page) =>
  page.evaluate(() => ({
    gateCards: document.querySelectorAll('#stage .gate').length,
    timelineRows: document.querySelectorAll('#stage .timeline > .ev').length,
    retrying: !document.querySelector('#stage .linkbar')?.hidden,
    lamp: document.getElementById('lamp')?.dataset.state,
    sockets: window.__sockets.length,
    approveInViewport: (() => {
      const b = document.querySelector('#stage .gate .btn--primary')
      if (!b) return false
      const r = b.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })(),
  }))

test('스트림이 끊기면 재연결하고, 그 사실을 화면에 말한다', { skip: !chromium && 'playwright 없음' }, async () => {
  const { page, errors } = await makePage()
  await page.goto(`${base}/#/live`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.evaluate((evs) => window.__feed(evs), EVENTS)
  await page.waitForTimeout(150)

  const live = await probe(page)
  assert.equal(live.gateCards, 1)
  assert.equal(live.retrying, false)
  assert.equal(live.sockets, 1)

  await page.evaluate(() => window.__drop())
  await page.waitForTimeout(250)
  // The old code closed the socket here and never came back — the timeline just
  // stopped growing and looked like an agent thinking.
  assert.equal((await probe(page)).retrying, true, '재연결 중이라는 표시가 없다')

  await page.waitForTimeout(1600) // first backoff is 1s
  const back = await probe(page)
  assert.equal(back.sockets, 2, '재연결하지 않았다')
  assert.equal(back.retrying, false)

  await page.close()
  assert.deepEqual(errors, [])
})

test('재연결 시 서버가 처음부터 다시 보내도 타임라인이 두 배가 되지 않는다', { skip: !chromium && 'playwright 없음' }, async () => {
  const { page } = await makePage()
  await page.goto(`${base}/#/live`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  await page.evaluate((evs) => window.__feed(evs), EVENTS)
  await page.waitForTimeout(150)
  const before = await probe(page)

  await page.evaluate(() => window.__drop())
  await page.waitForTimeout(1700)
  // `/api/runs/:id/stream` replays every event on every connect, by design.
  await page.evaluate((evs) => window.__feed(evs), EVENTS)
  await page.waitForTimeout(150)

  const after = await probe(page)
  assert.equal(after.timelineRows, before.timelineRows, '이벤트가 중복 적용됐다')
  assert.equal(after.gateCards, 1, '같은 게이트가 두 장이 됐다')
  await page.close()
})

test('탭을 닫았다 새로 열어도 대기 중인 승인 카드가 뜬다 — 리플레이가 없어도', { skip: !chromium && 'playwright 없음' }, async () => {
  // The reported failure: the server sat blocked on a gate, the reopened tab
  // showed nothing, and the approval had to be sent with curl. This page gets
  // an empty event replay on purpose — `/api/state` is the only source of
  // truth available to it, which is exactly the condition that broke.
  const { page, errors } = await makePage({ gateWaiting: true })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)

  const r = await probe(page)
  assert.equal(r.gateCards, 1, '대기 중인 게이트가 화면에 없다 — 사람이 풀 수 없다')
  assert.equal(r.approveInViewport, true, '승인 버튼이 화면 밖이다')
  assert.equal(r.lamp, 'gate')
  await page.close()
  assert.deepEqual(errors, [])
})

test('빠른 화면 전환이 뷰를 중복 마운트하지 않는다', { skip: !chromium && 'playwright 없음' }, async () => {
  // Assigning location.hash queues a hashchange *and* boot called the router
  // itself, so two async renders raced: both cleared the stage, both appended,
  // and the loser stayed subscribed while painting into detached DOM.
  const { page } = await makePage({ gateWaiting: false })
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  for (const hash of ['#/live', '#/history', '#/live', '#/launch', '#/live']) {
    await page.evaluate((h) => (location.hash = h), hash)
  }
  await page.waitForTimeout(600)
  const views = await page.evaluate(() => document.querySelectorAll('#stage .view').length)
  assert.equal(views, 1, `화면이 ${views}개 겹쳐 마운트됐다`)
  await page.close()
})
