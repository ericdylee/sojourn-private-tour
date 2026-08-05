import fs from 'node:fs'
import path from 'node:path'
import { OUTPUT_DIR, WORKSPACE_DIR, displayPath } from './paths.mjs'

/** Read a PNG's IHDR so the console can verify 1080×1080 without a render pass. */
function pngSize(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(24)
    fs.readSync(fd, buf, 0, 24, 0)
    if (buf.toString('ascii', 1, 4) !== 'PNG') return null
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
  } catch {
    return null
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd) } catch { /* ignore */ }
  }
}

function stat(file) {
  try {
    const s = fs.statSync(file)
    return { size: s.size, mtime: s.mtimeMs }
  } catch {
    return null
  }
}

/** Minimal front-matter reader — top-level scalars only, which is all we display. */
function frontMatter(text) {
  if (!text.startsWith('---')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { meta: {}, body: text }
  const raw = text.slice(3, end)
  const body = text.slice(text.indexOf('\n', end + 1) + 1)
  const meta = {}
  for (const line of raw.split('\n')) {
    const m = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (value === '' || value === '|' || value === '>') continue
    value = value.replace(/\s+#.*$/, '').trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[m[1]] = value
  }
  return { meta, body }
}

function readCards() {
  const dir = path.join(OUTPUT_DIR, 'cards')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.png'))
    .sort()
    .map((f) => {
      const abs = path.join(dir, f)
      const size = pngSize(abs)
      return {
        name: f,
        rel: displayPath(abs),
        ...stat(abs),
        dims: size,
        spec: size ? size.w === 1080 && size.h === 1080 : null,
      }
    })
}

function readBlog() {
  const abs = path.join(OUTPUT_DIR, 'blog.md')
  if (!fs.existsSync(abs)) return null
  const text = fs.readFileSync(abs, 'utf8')
  const { meta, body } = frontMatter(text)
  return {
    rel: displayPath(abs),
    ...stat(abs),
    meta,
    body,
    charCount: body.length,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  }
}

function readSocial() {
  const abs = path.join(OUTPUT_DIR, 'social.json')
  if (!fs.existsSync(abs)) return null
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'))
    // 500 chars per channel is the campaign spec (docs/PRD.md), not a platform cap.
    // X may ship as a thread; each tweet still has to clear 280.
    const SPEC_LIMIT = 500
    const posts = Object.entries(json.posts || {}).map(([channel, p]) => {
      const thread = Array.isArray(p.thread) ? p.thread : null
      const text = thread ? thread.join('\n\n') : p.text || ''
      return {
        channel,
        text,
        thread,
        threadParts: thread ? thread.map((t) => ({ text: t, chars: t.length, over: t.length > 280 })) : null,
        chars: text.length,
        declared: p.char_count ?? null,
        limit: SPEC_LIMIT,
        hashtags: p.hashtags || [],
        angle: p.angle || null,
      }
    })
    return {
      rel: displayPath(abs),
      ...stat(abs),
      campaignId: json.campaign_id,
      keyMessage: json.key_message,
      link: json.link || null,
      posts,
    }
  } catch (err) {
    return { rel: displayPath(abs), ...stat(abs), error: `JSON 파싱 실패: ${err.message}` }
  }
}

function readQa() {
  const abs = path.join(OUTPUT_DIR, 'qa_report.md')
  if (!fs.existsSync(abs)) return null
  const text = fs.readFileSync(abs, 'utf8')
  const verdict = /판정[:\s*]*\**\s*(PASS|HOLD)/i.exec(text)?.[1]?.toUpperCase() || null
  const counts = /BLOCKER\s*(\d+)\D+MAJOR\s*(\d+)(?:\D+MINOR\s*(\d+))?/i.exec(text)
  return {
    rel: displayPath(abs),
    ...stat(abs),
    verdict,
    blocker: counts ? Number(counts[1]) : null,
    major: counts ? Number(counts[2]) : null,
    minor: counts && counts[3] !== undefined ? Number(counts[3]) : null,
    text,
  }
}

function readWorkspace() {
  if (!fs.existsSync(WORKSPACE_DIR)) return []
  return fs
    .readdirSync(WORKSPACE_DIR, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const abs = path.join(WORKSPACE_DIR, e.name)
      return { name: e.name, rel: displayPath(abs), ...stat(abs) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function readArtifacts() {
  return {
    scannedAt: Date.now(),
    cards: readCards(),
    blog: readBlog(),
    social: readSocial(),
    qa: readQa(),
    workspace: readWorkspace(),
  }
}
