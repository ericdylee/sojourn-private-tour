import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isInterruptionResult, resolveFinalStatus, Run } from '../lib/runner.mjs'

/**
 * Drive `ingest` without a run directory or an LLM. The constructor writes to
 * `.runs/`, and none of that is what is under test — the question is only
 * whether a stream of SDK messages leaves the right marks behind.
 */
function fakeRun() {
  const run = Object.create(Run.prototype)
  Object.assign(run, {
    events: [],
    seq: 0,
    interrupted: null,
    resultSubtype: null,
    resultIsError: false,
    costUsd: 0,
    numTurns: 0,
    result: null,
    sessionId: null,
    harness: null,
    toolOwner: new Map(),
    toolName: new Map(),
    gateToolUses: new Set(),
    openGates: new Map(),
    subscribers: new Set(),
  })
  // The real `push` fans out to disk and SSE subscribers; here it just records.
  run.push = (event) => {
    const full = { seq: ++run.seq, t: 0, ...event }
    run.events.push(full)
    return full
  }
  run.persistMeta = () => {}
  return run
}

/**
 * How a finished run gets filed.
 *
 * The case that made this necessary is the one that looks fine from every
 * angle: run 2026-08-06T23-21-05 lost a `card-producer` delegation mid-flight,
 * the lead wrote "위임을 중단했습니다", and the SDK's final message still said
 * `subtype: "success"`, `is_error: false`. The console filed it as `done`.
 * The card HTML had been edited and never re-rendered — and a person reading
 * the screen had no way to know that.
 *
 * `done` has to mean "ran to the end with nothing skipped", or the status is
 * decoration and the operator has to re-derive it from the transcript.
 */

test('평범하게 끝난 실행은 done이다', () => {
  assert.equal(
    resolveFinalStatus({ aborted: false, interrupted: false, resultSubtype: 'success', resultIsError: false }),
    'done',
  )
})

test('사용자가 중단 버튼을 누르면 stopped다', () => {
  assert.equal(resolveFinalStatus({ aborted: true, interrupted: false, resultSubtype: 'success' }), 'stopped')
})

test('중단은 성공보다 우선한다 — SDK가 success라고 해도 stopped다', () => {
  // The abort is the most specific thing we know; the SDK's own subtype is a
  // description of the last turn, not of the run.
  assert.equal(
    resolveFinalStatus({ aborted: true, interrupted: true, resultSubtype: 'success', resultIsError: false }),
    'stopped',
  )
})

test('도구 호출이 잘린 실행은 done이 아니다 — 이게 실제로 났던 결함이다', () => {
  assert.equal(
    resolveFinalStatus({ aborted: false, interrupted: true, resultSubtype: 'success', resultIsError: false }),
    'interrupted',
  )
})

test('SDK가 success가 아닌 종료를 보고하면 done으로 올리지 않는다', () => {
  assert.equal(resolveFinalStatus({ resultSubtype: 'error_max_turns' }), 'interrupted')
  assert.equal(resolveFinalStatus({ resultSubtype: 'error_during_execution' }), 'interrupted')
})

test('is_error는 error로 간다', () => {
  assert.equal(resolveFinalStatus({ resultIsError: true, resultSubtype: 'success' }), 'error')
})

test('result 메시지가 아예 없어도 done으로 떨어진다 — 스트림이 정상 종료된 경우', () => {
  assert.equal(resolveFinalStatus({}), 'done')
})

test('중단 표식을 tool_result 본문에서 알아본다', () => {
  // Verbatim from the recorded run (seq 107).
  assert.equal(isInterruptionResult('[Request interrupted by user for tool use]'), true)
  assert.equal(isInterruptionResult('[Request interrupted by user]'), true)
})

test('정상 도구 출력은 중단으로 오인하지 않는다', () => {
  assert.equal(isInterruptionResult('exit 0 · 6장 렌더 완료'), false)
  assert.equal(isInterruptionResult('Exit code 143 Command timed out after 2m 0s'), false)
  assert.equal(isInterruptionResult(''), false)
  assert.equal(isInterruptionResult(null), false)
  assert.equal(isInterruptionResult(undefined), false)
})

test('그 문장을 읽거나 grep한 것은 중단이 아니다 — 이 레포가 그 문장을 적어 두고 있다', () => {
  // The sentinel now appears in runner.mjs, docs/PRD.md and the recorded events
  // under web/.runs/. An agent reading any of them must not file its own run as
  // interrupted; the marker replaces the whole result, so require exactly that.
  assert.equal(
    isInterruptionResult('const INTERRUPTION = /^\\[Request interrupted[^\\]]*\\]$/i'),
    false,
  )
  assert.equal(
    isInterruptionResult('web/.runs/x/events.jsonl:107: "[Request interrupted by user for tool use]"'),
    false,
  )
  assert.equal(isInterruptionResult('[Request interrupted by user for tool use] 뒤에 다른 출력'), false)
  // …while the marker itself still reads, whitespace and all.
  assert.equal(isInterruptionResult('\n  [Request interrupted by user for tool use]  \n'), true)
})

/* ---------- the recorded failure, replayed through ingest ---------- */

test('잘린 위임을 ingest가 잡아내고, 무엇이 잘렸는지 이름을 남긴다', () => {
  const run = fakeRun()

  run.ingest({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_01CcZhWnEsgPQcKD6Xjbwg64',
          name: 'Agent',
          input: { subagent_type: 'card-producer', description: 'QA 반려 3건 교정' },
        },
      ],
    },
  })
  run.ingest({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_01CcZhWnEsgPQcKD6Xjbwg64',
          is_error: true,
          content: '[Request interrupted by user for tool use]',
        },
      ],
    },
  })

  assert.ok(run.interrupted, '중단이 기록되지 않았다')
  assert.equal(run.interrupted.tool, 'Agent → card-producer')
  const notice = run.events.find((e) => e.type === 'notice' && e.level === 'warn')
  assert.ok(notice, '경고가 타임라인에 남지 않았다')
  assert.match(notice.text, /card-producer/)

  // The tidy ending the SDK reported for this very run.
  run.ingest({ type: 'result', subtype: 'success', is_error: false, result: '위임을 중단했습니다.' })
  assert.equal(run.resultSubtype, 'success')
  assert.equal(run.resultIsError, false)

  assert.equal(
    resolveFinalStatus({
      aborted: false,
      interrupted: Boolean(run.interrupted),
      resultSubtype: run.resultSubtype,
      resultIsError: run.resultIsError,
    }),
    'interrupted',
    'SDK가 success라고 보고해도 done이면 안 된다',
  )
})

test('정상 실행은 중단 표식을 남기지 않는다', () => {
  const run = fakeRun()
  run.ingest({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] },
  })
  run.ingest({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '01.png 02.png' }] },
  })
  run.ingest({ type: 'result', subtype: 'success', is_error: false, result: '완료' })

  assert.equal(run.interrupted, null)
  assert.equal(run.events.some((e) => e.type === 'notice' && e.level === 'warn'), false)
  assert.equal(
    resolveFinalStatus({
      aborted: false,
      interrupted: Boolean(run.interrupted),
      resultSubtype: run.resultSubtype,
      resultIsError: run.resultIsError,
    }),
    'done',
  )
})

test('게이트 툴 결과는 중단 판정 경로를 타지 않는다', () => {
  // Gate tool_uses are rendered as approval cards, and their results are
  // skipped before the interruption check. A cancelled run resolves them with
  // an explanatory string, which must not be mistaken for tool output either.
  const run = fakeRun()
  run.ingest({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id: 'g1', name: 'mcp__gate__ask_approval', input: { title: '발행할까요?' } }],
    },
  })
  run.ingest({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'g1', content: '승인' }] },
  })
  assert.equal(run.interrupted, null)
  assert.equal(run.events.some((e) => e.type === 'tool.result'), false)
})
