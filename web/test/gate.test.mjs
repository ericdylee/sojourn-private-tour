import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGate, GATE_TOOL_NAMES } from '../lib/gate.mjs'

/**
 * The gate is the one place where an agent blocks on a human. If it silently
 * resolves, an agent invents an answer and the campaign ships a claim nobody
 * approved — so every path here is exercised without an LLM in the loop.
 */

function handlerFor(gate, name) {
  const found = gate.tools.find((t) => t.name === name)
  assert.ok(found, `tool ${name} not registered (registered: ${gate.tools.map((t) => t.name).join(', ')})`)
  return found.handler
}

test('세 가지 게이트 툴이 등록된다', () => {
  const gate = createGate({ onRequest: () => {} })
  const names = gate.tools.map((t) => t.name)
  assert.deepEqual(names.sort(), ['ask_approval', 'ask_choice', 'ask_text'])
  assert.deepEqual(GATE_TOOL_NAMES.sort(), [
    'mcp__gate__ask_approval',
    'mcp__gate__ask_choice',
    'mcp__gate__ask_text',
  ])
})

test('ask_choice: 사람이 고른 값이 tool_result로 돌아온다', async () => {
  let opened = null
  const gate = createGate({ onRequest: (req) => (opened = req) })
  const call = handlerFor(gate, 'ask_choice')(
    { question: '소재를 고르세요', options: ['감천', '자갈치'], context: '배경' },
    {},
  )

  await new Promise((r) => setImmediate(r))
  assert.equal(opened.kind, 'choice')
  assert.equal(opened.question, '소재를 고르세요')
  assert.deepEqual(opened.options, ['감천', '자갈치'])

  assert.equal(gate.answer(opened.id, '자갈치'), true)
  const result = await call
  assert.equal(result.content[0].text, '자갈치')
})

test('ask_approval: 반려 사유가 그대로 전달된다', async () => {
  let opened = null
  const gate = createGate({ onRequest: (req) => (opened = req) })
  const call = handlerFor(gate, 'ask_approval')({ title: '발행할까요?', detail: '되돌릴 수 없음' }, {})

  await new Promise((r) => setImmediate(r))
  assert.equal(opened.kind, 'approval')
  assert.equal(opened.question, '발행할까요?')
  assert.equal(opened.detail, '되돌릴 수 없음')

  gate.answer(opened.id, '반려: QA가 HOLD다')
  assert.equal((await call).content[0].text, '반려: QA가 HOLD다')
})

test('ask_text: 자유 입력이 돌아온다', async () => {
  let opened = null
  const gate = createGate({ onRequest: (req) => (opened = req) })
  const call = handlerFor(gate, 'ask_text')({ question: '수정 지시는?' }, {})

  await new Promise((r) => setImmediate(r))
  assert.equal(opened.kind, 'text')
  gate.answer(opened.id, '3번 카드 서브카피를 줄여라')
  assert.equal((await call).content[0].text, '3번 카드 서브카피를 줄여라')
})

test('이미 처리된 게이트에 두 번 응답하면 거부된다', async () => {
  let opened = null
  const gate = createGate({ onRequest: (req) => (opened = req) })
  const call = handlerFor(gate, 'ask_text')({ question: 'q' }, {})
  await new Promise((r) => setImmediate(r))

  assert.equal(gate.answer(opened.id, '첫 응답'), true)
  assert.equal(gate.answer(opened.id, '두 번째'), false, '중복 응답은 거부되어야 한다')
  assert.equal((await call).content[0].text, '첫 응답')
})

test('cancelAll: 중단 시 대기 중인 호출이 전부 풀린다 — 프로세스가 매달리면 안 된다', async () => {
  const opened = []
  const gate = createGate({ onRequest: (req) => opened.push(req) })
  const a = handlerFor(gate, 'ask_text')({ question: 'a' }, {})
  const b = handlerFor(gate, 'ask_choice')({ question: 'b', options: ['1', '2'] }, {})
  await new Promise((r) => setImmediate(r))
  assert.equal(gate.listPending().length, 2)

  gate.cancelAll('실행이 중단됐다.')
  assert.equal(gate.listPending().length, 0)
  assert.equal((await a).content[0].text, '실행이 중단됐다.')
  assert.equal((await b).content[0].text, '실행이 중단됐다.')
})

test('onRequest가 던져도 호출이 영원히 매달리지 않는다', async () => {
  const gate = createGate({
    onRequest: () => {
      throw new Error('SSE 끊김')
    },
  })
  const result = await handlerFor(gate, 'ask_text')({ question: 'q' }, {})
  assert.match(result.content[0].text, /게이트 전달 실패/)
  assert.equal(gate.listPending().length, 0)
})
