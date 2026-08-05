import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const WEB_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const REPO_ROOT = path.dirname(WEB_ROOT)

export const OUTPUT_DIR = path.join(REPO_ROOT, 'output')
export const WORKSPACE_DIR = path.join(REPO_ROOT, '_workspace')
export const ASSETS_DIR = path.join(REPO_ROOT, 'assets')
export const BRIEF_PATH = path.join(WORKSPACE_DIR, '01_brief.json')

export const RUNS_DIR = path.join(WEB_ROOT, '.runs')
export const PUBLIC_DIR = path.join(WEB_ROOT, 'public')

/**
 * Resolve `rel` against `base`, refusing anything that escapes `base`.
 * Returns null instead of throwing so callers can answer 403 without a try block.
 */
export function safeResolve(base, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return null
  if (rel.includes('\0')) return null
  const resolved = path.resolve(base, rel)
  const withSep = base.endsWith(path.sep) ? base : base + path.sep
  if (resolved !== base && !resolved.startsWith(withSep)) return null
  return resolved
}

/** Path shown in the UI — always relative to the repo root, never absolute. */
export function displayPath(abs) {
  if (typeof abs !== 'string') return ''
  return abs.startsWith(REPO_ROOT + path.sep) ? abs.slice(REPO_ROOT.length + 1) : abs
}
