import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { RUNS_DIR, OUTPUT_DIR, WORKSPACE_DIR } from './paths.mjs'

/**
 * Run history on disk. One directory per run:
 *   web/.runs/<id>/meta.json          — status, mode, timings, cost
 *   web/.runs/<id>/events.jsonl       — the normalized event stream, appended live
 *   web/.runs/<id>/snapshot-before/   — output/ and _workspace/ as they were at launch
 *
 * The snapshot is why a bad run is survivable: output/ is the published artifact
 * set and _workspace/01_brief.json is the fact ledger every channel copies from.
 */

export function ensureRunsDir() {
  fs.mkdirSync(RUNS_DIR, { recursive: true })
}

export function runDir(id) {
  return path.join(RUNS_DIR, id)
}

export function createRunDir(id) {
  const dir = runDir(id)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * A snapshot is ~1.4 MB (six 1080² PNGs plus the workspace). Keep the newest
 * ones and drop the rest — the event log and meta stay forever, only the
 * rollback material ages out.
 */
const SNAPSHOT_KEEP = Number(process.env.CAMPAIGN_SNAPSHOT_KEEP || 20)

async function pruneSnapshots() {
  const runs = listRuns()
  for (const run of runs.slice(SNAPSHOT_KEEP)) {
    const dir = path.join(runDir(run.id), 'snapshot-before')
    if (!fs.existsSync(dir)) continue
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Copy output/ and _workspace/ so a destructive run can be rolled back. */
export async function snapshotBefore(id) {
  const dest = path.join(runDir(id), 'snapshot-before')
  await fsp.mkdir(dest, { recursive: true })
  const copied = []
  for (const [name, src] of [
    ['output', OUTPUT_DIR],
    ['_workspace', WORKSPACE_DIR],
  ]) {
    if (!fs.existsSync(src)) continue
    await fsp.cp(src, path.join(dest, name), { recursive: true, force: true })
    copied.push(name)
  }
  await pruneSnapshots()
  return copied
}

export function appendEvent(id, event) {
  try {
    fs.appendFileSync(path.join(runDir(id), 'events.jsonl'), JSON.stringify(event) + '\n')
  } catch {
    // History is best-effort. A full disk must not take down a live run.
  }
}

export function writeMeta(id, meta) {
  try {
    fs.writeFileSync(path.join(runDir(id), 'meta.json'), JSON.stringify(meta, null, 2))
  } catch {
    /* best-effort */
  }
}

export function readMeta(id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(runDir(id), 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

export function readEvents(id) {
  try {
    return fs
      .readFileSync(path.join(runDir(id), 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

export function listRuns() {
  ensureRunsDir()
  let entries = []
  try {
    entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => readMeta(e.name))
    .filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
}

/** Restore output/ and _workspace/ from a run's pre-launch snapshot. */
export async function restoreSnapshot(id) {
  const src = path.join(runDir(id), 'snapshot-before')
  if (!fs.existsSync(src)) throw new Error('이 실행에는 스냅샷이 없습니다')
  const restored = []
  for (const [name, dest] of [
    ['output', OUTPUT_DIR],
    ['_workspace', WORKSPACE_DIR],
  ]) {
    const from = path.join(src, name)
    if (!fs.existsSync(from)) continue
    await fsp.rm(dest, { recursive: true, force: true })
    await fsp.cp(from, dest, { recursive: true })
    restored.push(name)
  }
  return restored
}
