import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import {
  REPO_ROOT,
  PUBLIC_DIR,
  OUTPUT_DIR,
  WORKSPACE_DIR,
  ASSETS_DIR,
  safeResolve,
  within,
  displayPath,
} from './lib/paths.mjs'
import { Run } from './lib/runner.mjs'
import { AGENTS } from './lib/prompts.mjs'
import { readArtifacts } from './lib/artifacts.mjs'
import { readBrief, writeBrief, createBrief } from './lib/brief.mjs'
import { listPhotos, savePhoto, MAX_BYTES } from './lib/photos.mjs'
import * as store from './lib/runs.mjs'

const PORT = Number(process.env.PORT || 4173)
const HOST = '127.0.0.1' // local only, by design — the agents write to this repo

/**
 * CSRF defence.
 *
 * Binding to loopback keeps the network out; it does not keep *browsers* out.
 * Any page the operator visits can post to 127.0.0.1, and `POST /api/runs`
 * starts an agent with full tool access under their own credentials — so a
 * drive-by form submit would be remote code execution.
 *
 * A form POST cannot set a custom header (that would force a preflight this
 * server never answers), so requiring one on every state-changing request is
 * enough. The token is fetched from `/api/meta`, whose cross-origin response is
 * unreadable without CORS headers, which this server never sends.
 */
const TOKEN = randomBytes(24).toString('hex')
const ALLOWED_ORIGINS = new Set([`http://${HOST}:${PORT}`, `http://localhost:${PORT}`])

function checkMutation(req, res) {
  const method = req.method || 'GET'
  if (method === 'GET' || method === 'HEAD') return true

  const origin = req.headers.origin
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    fail(res, 403, '교차 출처 요청은 허용되지 않습니다.')
    return false
  }
  if (req.headers['x-console-token'] !== TOKEN) {
    fail(res, 403, '콘솔 토큰이 없거나 올바르지 않습니다. 브라우저에서 페이지를 새로고침하세요.')
    return false
  }
  return true
}

/** Exactly one run at a time: two runs would trample the same ledger and output/. */
let activeRun = null
/** Finished runs kept in memory so the browser can reconnect without re-reading disk. */
const recent = new Map()

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(payload)
}

function fail(res, status, message) {
  send(res, status, { error: message })
}

async function readJson(req, limit = 2_000_000) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('요청 본문이 너무 큽니다')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function runSummary(run) {
  return {
    id: run.id,
    mode: run.mode,
    agent: run.agent,
    instruction: run.instruction,
    title: run.title,
    model: run.model,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    error: run.error,
    costUsd: run.costUsd,
    numTurns: run.numTurns,
    harness: run.harness,
    openGates: [...run.openGates.values()],
  }
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath.slice(1))
  const abs = safeResolve(PUBLIC_DIR, rel)
  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, 404, 'not found')
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
  fs.createReadStream(abs).pipe(res)
}

/**
 * Headers for every repo-file response.
 *
 * These files are agent output, and `_workspace/03_cards.html` is literally
 * written by the card producer. The artifacts view links them with
 * `target="_blank"`, so without this a `<script>` in a card file would run as a
 * top-level document **on the console's own origin** — where it can read the
 * CSRF token from `GET /api/meta` (no token required to read) and then POST
 * `/api/runs` with an instruction of its choosing. That is agent execution with
 * every tool auto-approved, and it walks straight around the CSRF fix, which
 * only ever defended the cross-origin case.
 *
 * `sandbox` with no allow-* tokens drops the response into an opaque origin and
 * blocks script execution, so previews still render (styles, images, fonts) but
 * cannot reach back into the console. `nosniff` stops a mislabelled file from
 * being re-interpreted as HTML.
 */
const REPO_FILE_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': 'sandbox',
  'x-content-type-options': 'nosniff',
}

/** Serve a repo file for preview. Only the three directories the console shows. */
function serveRepoFile(res, rel) {
  // safeResolve returns a canonical path, so the allow-list has to be canonical
  // too — otherwise a symlink anywhere above the repo breaks the comparison.
  const abs = safeResolve(REPO_ROOT, rel)
  if (!abs) return fail(res, 403, '경로가 레포 밖을 가리킵니다')
  const allowed = [OUTPUT_DIR, WORKSPACE_DIR, ASSETS_DIR]
    .filter((dir) => fs.existsSync(dir))
    .map((dir) => fs.realpathSync(dir))
  if (!allowed.some((dir) => within(dir, abs))) {
    return fail(res, 403, 'output/, _workspace/, assets/ 안의 파일만 열 수 있습니다')
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, 404, '파일이 없습니다')
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { ...REPO_FILE_HEADERS, 'content-type': type })
  fs.createReadStream(abs).pipe(res)
}

function listProjectSkills() {
  const dir = path.join(REPO_ROOT, '.claude', 'skills')
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

function findRun(id) {
  if (activeRun?.id === id) return activeRun
  return recent.get(id) || null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const { pathname } = url
  const method = req.method || 'GET'

  try {
    // ---- static ----
    if (!pathname.startsWith('/api/')) return serveStatic(res, pathname)

    if (!checkMutation(req, res)) return

    // ---- meta ----
    if (pathname === '/api/meta' && method === 'GET') {
      return send(res, 200, {
        token: TOKEN,
        repoRoot: REPO_ROOT,
        model: process.env.CAMPAIGN_MODEL || 'claude-opus-5',
        agents: AGENTS,
        // The harness strip checks these names against what the session
        // actually loaded, so "8개" means the project's own skills, not the
        // CLI's bundled ones.
        projectSkills: listProjectSkills(),
      })
    }

    // ---- state ----
    if (pathname === '/api/state' && method === 'GET') {
      return send(res, 200, { activeRun: activeRun ? runSummary(activeRun) : null })
    }

    // ---- runs ----
    if (pathname === '/api/runs' && method === 'GET') {
      return send(res, 200, { runs: store.listRuns() })
    }

    if (pathname === '/api/runs' && method === 'POST') {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'starting')) {
        return fail(res, 409, '이미 실행 중입니다. 같은 원장을 두 실행이 밟으면 산출물이 깨집니다.')
      }
      const body = await readJson(req)
      if (!AGENTS.some((a) => a.id === body.agent)) return fail(res, 400, '알 수 없는 에이전트입니다.')
      const instruction = String(body.instruction || '').trim()
      if (!instruction) return fail(res, 400, '지시 내용을 입력하세요.')

      const run = new Run({ agent: body.agent, instruction })
      activeRun = run
      recent.set(run.id, run)
      // Fire and forget: the SSE stream is how the browser follows it.
      run.start().catch(() => {})
      return send(res, 201, { run: runSummary(run) })
    }

    let m
    if ((m = /^\/api\/runs\/([^/]+)\/stream$/.exec(pathname)) && method === 'GET') {
      const id = decodeURIComponent(m[1])
      const run = findRun(id)
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      })
      const events = run ? run.events : store.readEvents(id)
      for (const ev of events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
      if (run && (run.status === 'running' || run.status === 'starting')) {
        run.subscribe(res)
        const ping = setInterval(() => {
          try {
            res.write(': ping\n\n')
          } catch {
            clearInterval(ping)
          }
        }, 15000)
        res.on('close', () => clearInterval(ping))
      } else {
        res.end()
      }
      return
    }

    if ((m = /^\/api\/runs\/([^/]+)\/stop$/.exec(pathname)) && method === 'POST') {
      const run = findRun(decodeURIComponent(m[1]))
      if (!run) return fail(res, 404, '실행을 찾을 수 없습니다')
      return send(res, 200, { stopped: run.stop() })
    }

    if ((m = /^\/api\/runs\/([^/]+)\/restore$/.exec(pathname)) && method === 'POST') {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'starting')) {
        return fail(res, 409, '실행 중에는 복원할 수 없습니다')
      }
      const restored = await store.restoreSnapshot(decodeURIComponent(m[1]))
      return send(res, 200, { restored })
    }

    if ((m = /^\/api\/runs\/([^/]+)$/.exec(pathname)) && method === 'GET') {
      const id = decodeURIComponent(m[1])
      const run = findRun(id)
      if (run) return send(res, 200, { meta: runSummary(run), events: run.events })
      const meta = store.readMeta(id)
      if (!meta) return fail(res, 404, '실행을 찾을 수 없습니다')
      return send(res, 200, { meta, events: store.readEvents(id) })
    }

    // ---- gates ----
    if ((m = /^\/api\/gates\/([^/]+)$/.exec(pathname)) && method === 'POST') {
      const gateId = decodeURIComponent(m[1])
      const body = await readJson(req)
      const value = String(body.value ?? '').trim()
      if (!value) return fail(res, 400, '응답이 비어 있습니다')
      if (!activeRun) return fail(res, 409, '진행 중인 실행이 없습니다')
      if (!activeRun.answerGate(gateId, value)) {
        return fail(res, 404, '이미 처리됐거나 존재하지 않는 승인 요청입니다')
      }
      return send(res, 200, { ok: true })
    }

    // ---- artifacts ----
    if (pathname === '/api/artifacts' && method === 'GET') {
      return send(res, 200, readArtifacts())
    }

    if (pathname === '/api/file' && method === 'GET') {
      const rel = url.searchParams.get('path')
      if (!rel) return fail(res, 400, 'path 파라미터가 필요합니다')
      return serveRepoFile(res, rel)
    }

    // ---- brief ----
    if (pathname === '/api/brief' && method === 'GET') {
      return send(res, 200, readBrief())
    }

    // No strategist agent writes this file any more — the ledger is created and
    // maintained here, by a person.
    if (pathname === '/api/brief' && method === 'POST') {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'starting')) {
        return fail(res, 409, '실행 중에는 원장을 만들 수 없습니다.')
      }
      try {
        return send(res, 201, createBrief(await readJson(req)))
      } catch (err) {
        return send(res, 400, { error: err.message, validation: err.validation || null })
      }
    }

    if (pathname === '/api/brief' && method === 'PUT') {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'starting')) {
        return fail(res, 409, '실행 중에는 원장을 수정할 수 없습니다. 에이전트가 같은 파일을 읽고 있습니다.')
      }
      const patch = await readJson(req)
      try {
        return send(res, 200, writeBrief(patch))
      } catch (err) {
        return send(res, 400, { error: err.message, validation: err.validation || null })
      }
    }

    // ---- photos ----
    if (pathname === '/api/photos' && method === 'GET') {
      return send(res, 200, listPhotos())
    }

    /**
     * Upload. Body is JSON with the bytes base64'd rather than multipart: one
     * request carries the picture and its ledger entry together, which is what
     * makes it impossible to land a file without registering it.
     *
     * Refused while an agent is running, for the same reason the ledger is —
     * the producer reads this manifest mid-run, and a photo appearing underneath
     * it is a race with no upside.
     */
    if (pathname === '/api/photos' && method === 'POST') {
      if (activeRun && (activeRun.status === 'running' || activeRun.status === 'starting')) {
        return fail(res, 409, '실행 중에는 사진을 올릴 수 없습니다. 에이전트가 같은 원장을 읽고 있습니다.')
      }
      let body
      try {
        // base64 inflates by a third; the cap has to clear MAX_BYTES with room.
        body = await readJson(req, Math.ceil(MAX_BYTES * 1.4))
      } catch (err) {
        return fail(res, 413, err.message)
      }
      try {
        return send(res, 201, savePhoto(body))
      } catch (err) {
        return send(res, 400, { error: err.message, field: err.field ?? null })
      }
    }

    return fail(res, 404, 'not found')
  } catch (err) {
    if (!res.headersSent) return fail(res, 500, err?.message || String(err))
    try {
      res.end()
    } catch {
      /* already closed */
    }
  }
})

store.ensureRunsDir()

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `\n  Sojourn 콘텐츠 자동화\n  http://${HOST}:${PORT}\n  레포: ${displayPath(REPO_ROOT) || REPO_ROOT}\n` +
      `  토큰: ${TOKEN}\n` +
      `        브라우저는 자동으로 씁니다. curl 등으로 변경 요청을 보낼 때만\n` +
      `        'x-console-token' 헤더에 넣으세요. 재시작하면 새로 발급됩니다.\n\n`,
  )
})

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (activeRun) activeRun.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500).unref()
  })
}

export { server }
