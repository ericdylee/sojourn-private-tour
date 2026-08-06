import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { WEB_ROOT, WORKSPACE_DIR, OUTPUT_DIR, REPO_ROOT } from '../lib/paths.mjs'

/**
 * `/api/file` serves agent output. `_workspace/03_cards.html` is written by the
 * card producer, and the artifacts view links repo files with `target="_blank"`
 * — so the response is a top-level document, not a subresource.
 *
 * Served plain, a `<script>` in one of those files runs on the console's own
 * origin. From there it reads the CSRF token (`GET /api/meta` needs none) and
 * POSTs `/api/runs`, starting an agent whose tools are all auto-approved. The
 * token only ever defended the cross-origin case; same-origin script walks
 * around it.
 *
 * These tests boot the real server and read the real headers, because the value
 * only matters if it reaches the wire. They plant nothing: the files they ask
 * for are the ones actually at risk, which keeps a test run from showing up in
 * a QA pass over output/.
 */

let proc
let port
let token

function waitForBanner(child, ms = 20000) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`서버 기동 대기 시간 초과: ${buf}`)), ms)
    child.stdout.on('data', (d) => {
      buf += d
      const m = /http:\/\/127\.0\.0\.1:(\d+)[\s\S]*?토큰: (\w+)/.exec(buf)
      if (m) {
        clearTimeout(timer)
        resolve({ port: m[1], token: m[2] })
      }
    })
  })
}

/** A file that exists right now, relative to the repo root. */
function anExisting(dir, pattern) {
  if (!fs.existsSync(dir)) return null
  const hit = fs.readdirSync(dir).find((f) => pattern.test(f))
  return hit ? path.relative(REPO_ROOT, path.join(dir, hit)) : null
}

/**
 * Pick a free port ourselves. `PORT=0` binds an ephemeral port fine, but the
 * startup banner prints the configured value — literally "0" — so the test
 * could not find where the server actually landed.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(String(port)))
    })
  })
}

before(async () => {
  const chosen = await freePort()
  proc = spawn(process.execPath, ['server.mjs'], {
    cwd: WEB_ROOT,
    env: { ...process.env, PORT: chosen },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  ;({ port, token } = await waitForBanner(proc))
  assert.equal(port, chosen, '테스트가 띄운 서버에 붙어야 한다')
})

after(() => proc?.kill())

const get = (p) => fetch(`http://127.0.0.1:${port}${p}`)
const file = (rel) => get('/api/file?path=' + encodeURIComponent(rel))

test('에이전트가 쓴 HTML은 샌드박스로 나간다 — 스크립트가 콘솔 출처에서 못 돈다', async (t) => {
  const rel = anExisting(WORKSPACE_DIR, /\.html$/)
  if (!rel) return t.skip('_workspace/ 에 html이 없다')
  const res = await file(rel)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /text\/html/, '전제: html로 나간다')
  assert.match(
    res.headers.get('content-security-policy') ?? '',
    /\bsandbox\b/,
    'sandbox 가 없으면 이 문서는 콘솔 출처의 최상위 문서가 된다',
  )
})

test('MIME 재해석을 막는다 — nosniff', async (t) => {
  const rel = anExisting(WORKSPACE_DIR, /\.html$/)
  if (!rel) return t.skip('_workspace/ 에 html이 없다')
  const res = await file(rel)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('확장자별 예외가 없다 — 이미지도 같은 헤더로 나간다', async (t) => {
  const rel = anExisting(path.join(OUTPUT_DIR, 'cards'), /\.png$/)
  if (!rel) return t.skip('output/cards/ 에 png가 없다')
  const res = await file(rel)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-security-policy') ?? '', /\bsandbox\b/)
})

test('콘솔 자신의 화면은 샌드박스되지 않는다 — 앱이 죽으면 안 된다', async () => {
  const res = await get('/')
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-security-policy'), null)
})

test('토큰은 읽기만으로 노출된다 — 그래서 위 샌드박스가 방어선이다', async () => {
  const meta = await (await get('/api/meta')).json()
  assert.equal(meta.token, token, '시작 로그의 토큰과 같다 = GET 한 번이면 얻는다')
})

test('허용 디렉터리 밖은 여전히 403 — 이번 수정이 경로 가드를 건드리지 않았다', async () => {
  const res = await file('../etc/hosts')
  assert.equal(res.status, 403)
})
