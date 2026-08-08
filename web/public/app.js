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
  /** gateId → gate request, mirrored from the event stream. */
  gates: new Map(),
  /** actor → event count, drives the lane legend. */
  lanes: new Map(),
  harness: null,
  costUsd: 0,
  numTurns: 0,
  status: null,
  /** True while replaying a finished run from history (no live stream). */
  replay: false,
  view: 'launch',
}

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
  state.lanes = new Map()
  state.harness = null
  state.costUsd = 0
  state.numTurns = 0
  state.status = null
}

function applyEvent(ev) {
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

function closeStream() {
  if (stream) {
    stream.close()
    stream = null
  }
}

function connectStream(runId, { replay = false } = {}) {
  closeStream()
  resetRunState()
  state.replay = replay
  emit('run-reset')

  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream`)
  es.onmessage = (e) => {
    try {
      applyEvent(JSON.parse(e.data))
    } catch (err) {
      console.error('bad event frame', err)
    }
  }
  es.onerror = () => {
    // The server ends the stream when a run finishes; EventSource treats a
    // clean close as an error and would otherwise reconnect forever.
    es.close()
    if (stream === es) stream = null
    paintLamp()
  }
  stream = es
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
    await api(`/api/gates/${encodeURIComponent(gateId)}`, {
      method: 'POST',
      body: JSON.stringify({ value }),
    })
  },

  async openRun(id, { replay = true } = {}) {
    const { meta } = await api(`/api/runs/${encodeURIComponent(id)}`)
    state.run = meta
    connectStream(id, { replay })
    location.hash = '#/live'
  },

  async refreshState() {
    const { activeRun } = await api('/api/state')
    if (activeRun && (!state.run || state.run.id !== activeRun.id)) {
      state.run = activeRun
      connectStream(activeRun.id)
    } else if (activeRun) {
      state.run = activeRun
    }
    return activeRun
  },

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
  else if (state.status === 'running' || state.status === 'starting') s = 'running'
  else if (state.status === 'error' || state.status === 'stopped') s = 'error'
  else if (state.status === 'done') s = 'done'
  lamp.dataset.state = s
  lamp.title = { idle: '대기 중', running: '실행 중', gate: '승인 대기', done: '완료', error: '중단/오류' }[s]
  if (pip) pip.hidden = state.gates.size === 0
}

/* ==========================================================================
   Router
   ========================================================================== */

const VIEWS = { launch, live, artifacts, brief, photos, history }
let current = null

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'launch'
  const [name, arg] = hash.split('/')
  const view = VIEWS[name] ? name : 'launch'

  if (current?.destroy) {
    try {
      current.destroy()
    } catch (err) {
      console.error('destroy', err)
    }
  }

  state.view = view
  for (const link of document.querySelectorAll('.rail__link')) {
    link.classList.toggle('is-active', link.dataset.view === view)
  }

  const stage = clear($('#stage'))
  stage.scrollTop = 0
  const ctx = { state, api, actions, on, emit }
  try {
    current = (await VIEWS[view].render(stage, ctx, arg)) || null
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

async function boot() {
  initLightbox()
  window.addEventListener('hashchange', route)

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
