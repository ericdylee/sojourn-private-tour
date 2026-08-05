import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeResolve, within } from '../lib/paths.mjs'

/**
 * The console serves files out of output/, _workspace/ and assets/. Those three
 * directories are the whole allow-list, so anything that walks out of them
 * turns a preview endpoint into arbitrary file read.
 *
 * `path.resolve` alone is not enough: it normalises `..` but follows symlinks,
 * and an agent has Bash — it can plant one. This suite pins the canonical-path
 * behaviour that closes that.
 */

let base
let outside

before(() => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sojourn-paths-')))
  base = path.join(root, 'base')
  outside = path.join(root, 'outside')
  fs.mkdirSync(path.join(base, 'nested'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(base, 'ok.txt'), 'inside')
  fs.writeFileSync(path.join(base, 'nested', 'deep.txt'), 'inside')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'SHOULD NOT BE READABLE')
})

after(() => {
  try {
    fs.rmSync(path.dirname(base), { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

test('내부 파일은 정규 경로로 통과한다', () => {
  assert.equal(safeResolve(base, 'ok.txt'), path.join(base, 'ok.txt'))
  assert.equal(safeResolve(base, 'nested/deep.txt'), path.join(base, 'nested', 'deep.txt'))
})

test('.. 탈출은 거부된다', () => {
  assert.equal(safeResolve(base, '../outside/secret.txt'), null)
  assert.equal(safeResolve(base, 'nested/../../outside/secret.txt'), null)
  assert.equal(safeResolve(base, '/etc/hosts'), null)
})

test('빈 값·NUL 바이트는 거부된다', () => {
  assert.equal(safeResolve(base, ''), null)
  assert.equal(safeResolve(base, 'ok\0.txt'), null)
  assert.equal(safeResolve(base, null), null)
})

test('디렉터리 심볼릭 링크로는 밖을 못 읽는다 — path.resolve만으로는 뚫린다', () => {
  const link = path.join(base, 'escape-dir')
  fs.symlinkSync(outside, link, 'dir')
  try {
    // 사전 확인: 순수 문자열 해석으로는 base 안으로 보인다.
    assert.ok(within(base, path.resolve(base, 'escape-dir/secret.txt')))
    // 실제로는 밖을 가리키므로 거부돼야 한다.
    assert.equal(safeResolve(base, 'escape-dir/secret.txt'), null)
  } finally {
    fs.unlinkSync(link)
  }
})

test('파일 심볼릭 링크로도 밖을 못 읽는다', () => {
  const link = path.join(base, 'escape-file.txt')
  fs.symlinkSync(path.join(outside, 'secret.txt'), link, 'file')
  try {
    assert.equal(safeResolve(base, 'escape-file.txt'), null)
  } finally {
    fs.unlinkSync(link)
  }
})

test('base 안을 가리키는 심볼릭 링크는 허용된다', () => {
  const link = path.join(base, 'inside-link.txt')
  fs.symlinkSync(path.join(base, 'ok.txt'), link, 'file')
  try {
    assert.equal(safeResolve(base, 'inside-link.txt'), path.join(base, 'ok.txt'))
  } finally {
    fs.unlinkSync(link)
  }
})

test('없는 파일은 통과시키되 경로는 탈출하지 않는다 — 호출자가 존재를 확인한다', () => {
  assert.equal(safeResolve(base, 'nope.txt'), path.join(base, 'nope.txt'))
  assert.equal(safeResolve(base, '../nope.txt'), null)
})

test('within: 접두사만 같은 형제 디렉터리를 안쪽으로 오판하지 않는다', () => {
  assert.equal(within('/a/base', '/a/base-evil/x'), false)
  assert.equal(within('/a/base', '/a/base/x'), true)
  assert.equal(within('/a/base', '/a/base'), true)
})
