import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

export const WEB_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const REPO_ROOT = path.dirname(WEB_ROOT)

export const OUTPUT_DIR = path.join(REPO_ROOT, 'output')
export const WORKSPACE_DIR = path.join(REPO_ROOT, '_workspace')
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets')
export const BRIEF_PATH = path.join(WORKSPACE_DIR, '01_brief.json')

export const RUNS_DIR = path.join(WEB_ROOT, '.runs')
export const PUBLIC_DIR = path.join(WEB_ROOT, 'public')

/** Is `target` `dir` itself, or inside it? Pure string comparison. */
export function within(dir, target) {
  if (target === dir) return true
  return target.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
}

/**
 * Resolve `rel` against `base`, refusing anything that escapes `base`.
 *
 * `path.resolve` normalises `..` but happily walks through a symlink, so a link
 * planted inside output/ (an agent has Bash; it can make one) would otherwise
 * hand out any file on disk. Both sides are canonicalised with realpath before
 * the containment check, and the canonical path is what callers get back.
 *
 * Returns null instead of throwing so callers can answer 403 without a try block.
 */
export function safeResolve(base, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null
  if (rel.includes('\0')) return null

  const resolved = path.resolve(base, rel)
  if (!within(base, resolved)) return null

  let realBase
  try {
    realBase = fs.realpathSync(base)
  } catch {
    return null
  }

  try {
    const realTarget = fs.realpathSync(resolved)
    return within(realBase, realTarget) ? realTarget : null
  } catch (err) {
    // The path does not exist yet. The lexical check above already proved it
    // cannot escape, and every caller checks existence before reading.
    if (err.code === 'ENOENT') return resolved
    return null
  }
}

/** Path shown in the UI — always relative to the repo root, never absolute. */
export function displayPath(abs) {
  if (typeof abs !== 'string') return ''
  return abs.startsWith(REPO_ROOT + path.sep) ? abs.slice(REPO_ROOT.length + 1) : abs
}
