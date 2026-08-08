import { $, clear, toast, initLightbox } from './ui.js'
import * as launch from './views/launch.js'
import * as live from './views/live.js'
import * as artifacts from './views/artifacts.js'
import * as brief from './views/brief.js'
import * as photos from './views/photos.js'
import * as history from './views/history.js'

/* ==========================================================================
   Store
   ========================================================================== */

export const state = {
  meta: null,
  /** Summary of the run currently attached to the stream (live or replayed). */
  run: null,
  /** Normalized events for `run`. */
  events: [],
  /** gateId → gate request. Fed by the event stream *and* by /api/state. */
  gates: new Map(),
  /** Gate ids already answered, so a stale /api/state cannot resurrect one. */
  answered: new Set(),
  /** actor → event count, drives the lane legend. */
  lanes: new Map(),
  harness: null,
  costUsd: 0,
  numTurns: 0,
  status: null,
  /** True while replaying a finished run from history (no live stream). */
  replay: false,
  /** Highest event seq applied. The server replays from the top on every
   *  (re)connect, so this is what keeps a reconnect from doubling the timeline. */
  lastSeq: 0,
  /** Stream health: 'live' | 'retry' | 'closed'. Shown, not just logged — a
   *  dead feed used to look exactly like an agent that had gone quiet. */
  link: 'closed',
  view: 'launch',
}

/** A run that is over. Nothing will arrive on its stream again. */
const FINISHED = ['done', 'stopped', 'error', 'interrupted']

/* ---------- tiny event bus ---------- */

const bus = new Map()
export function on(type, fn) {
  if (!bus.has(type)) bus.set(type, new Set())
  bus.get(type).add(fn)
  return () => bus.get(type).delete(fn)
}
function emit(type, payload) {
  for (const fn of bus.get(type) || []) {
    try {
      fn(payload)
    } catch (err) {
      console.error(`[bus:${type}]`, err)
    }
  }
}

/* ==========================================================================
   API
   ========================================================================== */

/**
 * Fetched once from /api/meta and echoed back on every state-changing request.
 * A cross-origin page cannot read it (no CORS headers) and cannot set a custom
 * header without a preflight the server never answers, so this is what stops a
 * drive-by form POST from starting an agent on the operator's machine.
 */
let token = null

export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase()
  const headers = { ...(opts.headers || {}) }
  if (opts.body) headers['content-type'] = 'application/json'
  if (method !== 'GET' && method !== 'HEAD' && token) headers['x-console-token'] = token

  const res = await fetch(path, { ...opts, headers })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.payload = data
    throw err
  }
  return data
}

/* ==========================================================================
   Event application
   ========================================================================== */

function resetRunState() {
  state.events = []
  state.gates = new Map()
  state.answered = new Set()
  state.lanes = new Map()
  state.harness = null
  state.costUsd = 0
  state.numTurns = 0
  state.status = null
  state.lastSeq = 0
}

function applyEvent(ev) {
  // Every connection replays the run from event 1. Without this, one reconnect
  // paints the whole timeline twice and re-opens gates that were answered.
  if (typeof ev.seq === 'number') {
    if (ev.seq <= state.lastSeq) return
    state.lastSeq = ev.seq
  }
  state.events.push(ev)

  if (ev.actor) state.lanes.set(ev.actor, (state.lanes.get(ev.actor) || 0) + 1)

  switch (ev.type) {
    case 'session.init':
      state.harness = ev
      break
    case 'gate.open':
      state.gates.set(ev.id, ev)
      break
    case 'gate.answered':
      state.gates.delete(ev.gateId)
      state.answered.add(ev.gateId)
      break
    case 'run.started':
      state.status = 'running'
      break
    case 'run.result':
      state.costUsd = ev.costUsd ?? state.costUsd
      state.numTurns = ev.numTurns ?? state.numTurns
      break
    case 'run.ended':
      state.status = ev.status
      state.costUsd = ev.costUsd ?? state.costUsd
      state.gates.clear()
      break
    case 'run.error':
      state.status = 'error'
      break
  }

  emit('event', ev)
  paintLamp()
}

/* ==========================================================================
   Stream
   ========================================================================== */

let stream = null
let streamRunId = null
let retryTimer = null
let retries = 0

function setLink(next) {
  if (state.link === next) return
  state.link = next
  emit('link', next)
  paintLamp()
}

function closeStream() {
  clearTimeout(retryTimer)
  retryTimer = null
  retries = 0
  streamRunId = null
  if (stream) {
    stream.close()
    stream = null
  }
  setLink('closed')
}

/**
 * Follow a run.
 *
 * The first version closed the socket on the first `onerror` and never came
 * back, because the only error it expected was the server hanging up on a
 * finished run. Every other cause — a backgrounded tab, a sleeping laptop, a
 * closed and reopened window — looked identical: the timeline simply stopped
 * growing and gates opened after that point never appeared. The screen went on
 * looking like a running agent.
 *
 * So: reconnect while the run is still alive, ask the server rather than guess
 * when it isn't, and say on screen which of the two is happening.
 */
function connectStream(runId, { replay = false } = {}) {
  closeStream()
  resetRunState()
  state.replay = replay
  streamRunId = runId
  emit('run-reset')
  openSocket(runId)
}

function openSocket(runId) {
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`)

  es.onopen = () => {
    retries = 0
    setLink('live')
  }

  es.onmessage = (e) => {
    try {
      applyEvent(JSON.parse(e.data))
    } catch (err) {
      console.error('bad event frame', err)
    }
  }

  es.onerror = async () => {
    es.close()
    if (stream !== es) return // superseded by a newer connection
    stream = null

    // A finished run's stream is closed by the server on purpose, and
    // EventSource reports that clean close as an error too.
    if (FINISHED.includes(state.status)) {
      setLink('closed')
      return
    }

    setLink('retry')
    // Don't infer from local state whether the run is still going — local state
    // is exactly what a dropped connection makes stale.
    const live = await isRunLive(runId)
    if (!live) {
      setLink('closed')
      await syncFromServer().catch(() => {})
      return
    }
    const delay = Math.min(1000 * 2 ** retries++, 15000)
    retryTimer = setTimeout(() => {
      if (streamRunId === runId) openSocket(runId)
    }, delay)
  }

  stream = es
}

async function isRunLive(runId) {
  try {
    const { meta } = await api(`/api/runs/${encodeURIComponent(runId)}`)
    return meta?.status === 'running' || meta?.status === 'starting'
  } catch {
    // The server itself is unreachable. That is a reason to keep trying, not to
    // decide the run is over.
    return true
  }
}

/**
 * Put the server's open gates on screen.
 *
 * `/api/state` has always carried `openGates` and nothing ever read them — the
 * cards were built purely from the event stream. So any tab that missed the
 * stream saw no card at all while the server sat blocked on a human, which is
 * how an approval ends up being sent by hand with `POST /api/gates/:id`.
 *
 * Additive on purpose: the stream stays the detailed record, this is the floor
 * under it. `answered` is what stops a reply that crossed in flight from
 * putting a card back.
 */
function seedGates(run) {
  let changed = false
  for (const g of run?.openGates || []) {
    if (state.answered.has(g.id) || state.gates.has(g.id)) continue
    state.gates.set(g.id, g)
    changed = true
  }
  return changed
}

/**
 * Take the server's word for what is open right now — used when we know the
 * local picture may have drifted: a reconnect, a tab coming back to the
 * foreground, a gate answer the server rejected.
 */
export async function syncFromServer() {
  const { activeRun } = await api('/api/state')
  if (!activeRun) {
    if (!state.replay && !FINISHED.includes(state.status)) state.gates.clear()
    emit('synced', null)
    paintLamp()
    return null
  }
  if (state.run && state.run.id === activeRun.id && !state.replay) {
    state.run = activeRun
    state.status = activeRun.status
    // Authoritative here: the server drops a gate from `openGates` the moment
    // it is answered, so replacing the map cannot resurrect anything.
    state.gates = new Map(
      (activeRun.openGates || []).filter((g) => !state.answered.has(g.id)).map((g) => [g.id, g]),
    )
  } else if (!state.run) {
    state.run = activeRun
    connectStream(activeRun.id)
    seedGates(activeRun)
  }
  emit('synced', activeRun)
  paintLamp()
  return activeRun
}

/* ==========================================================================
   Actions
   ========================================================================== */

export const actions = {
  async startRun(payload) {
    const { run } = await api('/api/runs', { method: 'POST', body: JSON.stringify(payload) })
    state.run = run
    state.status = run.status
    connectStream(run.id)
    location.hash = '#/live'
    toast('실행을 시작했습니다', 'good')
    return run
  },

  async stopRun() {
    if (!state.run) return
    await api(`/api/runs/${encodeURIComponent(state.run.id)}/stop`, { method: 'POST' })
    toast('중단 요청을 보냈습니다. 에이전트가 안전한 지점에서 멈춥니다.')
  },

  async answerGate(gateId, value) {
    try {
      await api(`/api/gates/${encodeURIComponent(gateId)}`, {
        method: 'POST',
        body: JSON.stringify({ value }),
      })
    } catch (err) {
      // The card the operator just pressed was describing a gate the server no
      // longer has. Repaint from the server so the screen stops lying, then let
      // the caller report the failure.
      await syncFromServer().catch(() => {})
      throw err
    }
  },

  async openRun(id, { replay = true } = {}) {
    const { meta } = await api(`/api/runs/${encodeURIComponent(id)}`)
    state.run = meta
    connectStream(id, { replay })
    location.hash = '#/live'
  },

  async refreshState() {
    const { activeRun } = await api('/api/state')
    if (!activeRun) return null
    const attaching = !state.run || state.run.id !== activeRun.id
    state.run = activeRun
    // connectStream wipes run state, so seeding has to come after it.
    if (attaching) connectStream(activeRun.id)
    state.status = activeRun.status
    seedGates(activeRun)
    emit('synced', activeRun)
    paintLamp()
    return activeRun
  },

  sync: syncFromServer,

  isBusy() {
    return state.run && (state.status === 'running' || state.status === 'starting') && !state.replay
  },
}

/* ==========================================================================
   Chrome
   ========================================================================== */

function paintLamp() {
  const lamp = $('#lamp')
  const pip = $('#rail-pip')
  if (!lamp) return
  let s = 'idle'
  if (state.gates.size > 0) s = 'gate'
  else if (state.link === 'retry') s = 'link'
  else if (state.status === 'running' || state.status === 'starting') s = 'running'
  else if (state.status === 'error' || state.status === 'stopped' || state.status === 'interrupted') s = 'error'
  else if (state.status === 'done') s = 'done'
  lamp.dataset.state = s
  lamp.title = {
    idle: '대기 중',
    running: '실행 중',
    gate: '승인 대기',
    link: '연결 끊김 — 재연결 중',
    done: '완료',
    error: '중단/오류',
  }[s]
  if (pip) pip.hidden = state.gates.size === 0
}

/* ==========================================================================
   Router
   ========================================================================== */

const VIEWS = { launch, live, artifacts, brief, photos, history }
let current = null
/** Hash of the view currently mounted, so the same one isn't mounted twice. */
let mounted = null
/** Bumped per render; a render that finishes after a newer one started is dropped. */
let renderSeq = 0

/**
 * `render()` is async, so two overlapping calls both clear the stage and both
 * append — leaving one view's DOM detached while its event subscription stays
 * alive, painting into nodes nobody can see. Boot used to do exactly that:
 * assigning `location.hash` queues a `hashchange` that fires the router, and
 * boot then called the router itself.
 */
async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'launch'
  const [name, arg] = hash.split('/')
  const view = VIEWS[name] ? name : 'launch'

  if (hash === mounted && current) return
  const seq = ++renderSeq
  mounted = hash

  if (current?.destroy) {
    try {
      current.destroy()
    } catch (err) {
      console.error('destroy', err)
    }
  }
  current = null

  state.view = view
  for (const link of document.querySelectorAll('.rail__link')) {
    link.classList.toggle('is-active', link.dataset.view === view)
  }

  const stage = clear($('#stage'))
  stage.scrollTop = 0
  const ctx = { state, api, actions, on, emit }
  try {
    const ctrl = (await VIEWS[view].render(stage, ctx, arg)) || null
    if (seq !== renderSeq) {
      // A newer route won while this one was still rendering. Unsubscribe it,
      // or it keeps painting into DOM that has already been cleared away.
      try {
        ctrl?.destroy?.()
      } catch (err) {
        console.error('destroy', err)
      }
      return
    }
    current = ctrl
  } catch (err) {
    console.error(err)
    // textContent, not innerHTML: err.message carries server text and file
    // paths, and those trace back to agent-written names. An error string is a
    // silly place to hand out script execution on this origin.
    const box = document.createElement('div')
    box.className = 'body'
    const notice = document.createElement('div')
    notice.className = 'notice notice--bad'
    notice.textContent = `화면을 그리지 못했습니다: ${err.message}`
    box.append(notice)
    stage.append(box)
  }
}

/* ==========================================================================
   Boot
   ========================================================================== */

/**
 * Come back from a backgrounded tab.
 *
 * Browsers throttle and eventually drop connections in hidden tabs, so the
 * moment the console is looked at again is the moment its picture is most
 * likely to be out of date — and the thing most likely to be missing from it is
 * a gate the agent is blocked on.
 */
function wakeUp() {
  if (document.visibilityState !== 'visible') return
  if (state.replay || !state.run) return
  if (FINISHED.includes(state.status)) return
  syncFromServer().catch(() => {})
  if (!stream && streamRunId) {
    clearTimeout(retryTimer)
    retries = 0
    openSocket(streamRunId)
  }
}

async function boot() {
  initLightbox()
  window.addEventListener('hashchange', route)
  document.addEventListener('visibilitychange', wakeUp)
  window.addEventListener('online', wakeUp)

  try {
    state.meta = await api('/api/meta')
    token = state.meta.token
    const model = $('#rail-model')
    if (model) model.textContent = state.meta.model
  } catch (err) {
    toast(`서버에 연결하지 못했습니다: ${err.message}`, 'bad')
  }

  try {
    const active = await actions.refreshState()
    if (active && !location.hash) location.hash = '#/live'
  } catch {
    /* no active run */
  }

  await route()
  paintLamp()
}

boot()
