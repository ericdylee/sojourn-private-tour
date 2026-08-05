import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, PUBLIC_DIR, OUTPUT_DIR, WORKSPACE_DIR, ASSETS_DIR, safeResolve, displayPath } from './lib/paths.mjs'
import { Run } from './lib/runner.mjs'
import { AGENTS } from './lib/prompts.mjs'
import { readArtifacts } from './lib/artifacts.mjs'
import { readBrief, writeBrief, createBrief } from './lib/brief.mjs'
import * as store from './lib/runs.mjs'

const PORT = Number(process.env.PORT || 4173)
const HOST = '127.0.0.1' // local only, by design — the agents write to this repo

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

/** Serve a repo file for preview. Only the three directories the console shows. */
function serveRepoFile(res, rel) {
  const abs = safeResolve(REPO_ROOT, rel)
  if (!abs) return fail(res, 403, '경로가 레포 밖을 가리킵니다')
  const allowed = [OUTPUT_DIR, WORKSPACE_DIR, ASSETS_DIR]
  if (!allowed.some((dir) => abs === dir || abs.startsWith(dir + path.sep))) {
    return fail(res, 403, 'output/, _workspace/, assets/ 안의 파일만 열 수 있습니다')
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return fail(res, 404, '파일이 없습니다')
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' })
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

    // ---- meta ----
    if (pathname === '/api/meta' && method === 'GET') {
      return send(res, 200, {
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
    `\n  Sojourn 캠페인 콘솔\n  http://${HOST}:${PORT}\n  레포: ${displayPath(REPO_ROOT) || REPO_ROOT}\n\n`,
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
