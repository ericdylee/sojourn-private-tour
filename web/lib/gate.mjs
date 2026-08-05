import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

/**
 * The approval gate.
 *
 * A headless agent that is told "ask the user" has nowhere to ask, so it invents
 * an answer and keeps going. These tools give it a real channel: the call blocks
 * server-side while the browser renders a card, and the person's answer comes
 * back as the tool result.
 */

export const GATE_TOOL_NAMES = [
  'mcp__gate__ask_choice',
  'mcp__gate__ask_approval',
  'mcp__gate__ask_text',
]

export const GATE_INSTRUCTIONS = `
## 사람의 결정이 필요할 때 (반드시 지켜라)

너는 웹 콘솔에서 헤드리스로 실행되고 있다. 사용자는 대화창을 보고 있지 않으므로
**텍스트로 질문을 쓰고 턴을 끝내면 아무도 답하지 않고 실행이 그대로 죽는다.**

사람의 판단이 필요한 모든 지점에서는 반드시 아래 툴 중 하나를 호출하라:

- \`mcp__gate__ask_choice\` — 후보 중 하나를 고르게 할 때
  (예: 캠페인 소재 후보 3개, 카드 카피 A/B, 다음 장소 편 선택)
- \`mcp__gate__ask_approval\` — 진행 여부 승인을 받을 때
  (예: QA 판정 결과 확인 후 발행 단계 진입, 릴스 씬 구성표 승인,
   기존 output/·_workspace/ 를 덮어쓰기 전 확인, 크레딧 소모 생성 전 확인)
- \`mcp__gate__ask_text\` — 자유 서술 입력이 필요할 때
  (예: 반려 사유, 수정 지시, 누락된 사실 값)

이 툴들은 사람이 응답할 때까지 블로킹된다. 기다리는 것이 정상이다.
임의로 값을 정해 진행하지 마라. 특히 브리프 \`facts\` 원장에 없는
가격·소요시간·운영시간을 추측으로 채우는 것은 금지다.
`.trim()

/**
 * @param {(req: {id:string, kind:string, question:string, options?:string[], context?:string, detail?:string, title?:string}) => void} onRequest
 *   Called when an agent opens a gate. Wire this to the SSE hub.
 */
export function createGate({ onRequest }) {
  /** @type {Map<string, {resolve:(v:string)=>void, request:object}>} */
  const pending = new Map()

  function open(request) {
    const id = randomUUID()
    return new Promise((resolve) => {
      const entry = { resolve, request: { id, ...request, openedAt: Date.now() } }
      pending.set(id, entry)
      try {
        onRequest(entry.request)
      } catch (err) {
        pending.delete(id)
        resolve(`게이트 전달 실패: ${err.message}. 사용자에게 물을 수 없으니 이 결정을 보류하고 보고하라.`)
      }
    })
  }

  // Kept as a named list so the gate's contract stays inspectable. Once these
  // go into createSdkMcpServer they are swallowed by the MCP server instance,
  // and reaching back through `_registeredTools` to test them would couple us
  // to SDK internals.
  const tools = [
      tool(
        'ask_choice',
        '사람에게 후보 중 하나를 고르게 한다. 캠페인 소재 선택처럼 결정이 하나로 수렴해야 하는 지점에서 호출하라. 사람이 고를 때까지 블로킹되며, 선택된 항목의 문자열이 반환된다. 사람은 "기타"로 직접 입력할 수도 있으므로 반환값이 options에 없을 수 있다.',
        {
          question: z.string().describe('사람에게 보여줄 질문. 한국어로 명확하게.'),
          options: z
            .array(z.string())
            .min(2)
            .max(8)
            .describe('선택지 2~8개. 각 항목은 그 자체로 이해되도록 충분히 서술할 것.'),
          context: z
            .string()
            .optional()
            .describe('판단에 필요한 배경. 각 선택지의 트레이드오프를 여기 적어라.'),
        },
        async (args) => {
          const answer = await open({ kind: 'choice', ...args })
          return { content: [{ type: 'text', text: answer }] }
        },
      ),
      tool(
        'ask_approval',
        '사람에게 진행 승인을 받는다. QA 판정 후 발행 단계 진입, 릴스 착수, 기존 산출물 덮어쓰기, 유료 크레딧 소모 등 되돌리기 어려운 행동 직전에 호출하라. "승인" 또는 "반려: <사유>" 가 반환된다. 반려되면 그 사유를 반영해 다시 시도하거나 보고하고 멈춰라.',
        {
          title: z.string().describe('승인받을 행동 한 줄 요약'),
          detail: z
            .string()
            .describe('무엇이 바뀌는지, 되돌릴 수 있는지, 확인해야 할 위험을 구체적으로.'),
        },
        async (args) => {
          const answer = await open({ kind: 'approval', question: args.title, ...args })
          return { content: [{ type: 'text', text: answer }] }
        },
      ),
      tool(
        'ask_text',
        '사람에게 자유 서술 입력을 받는다. 반려 사유, 수정 지시, 원장에 없는 사실 값 확인 등에 쓴다. 사람이 입력한 문자열이 반환된다.',
        {
          question: z.string().describe('사람에게 보여줄 질문'),
          context: z.string().optional().describe('배경 설명'),
          placeholder: z.string().optional().describe('입력 예시'),
        },
        async (args) => {
          const answer = await open({ kind: 'text', ...args })
          return { content: [{ type: 'text', text: answer }] }
        },
      ),
  ]

  const server = createSdkMcpServer({
    name: 'gate',
    version: '1.0.0',
    instructions:
      '웹 콘솔의 사람에게 직접 질문하는 채널. 사람의 판단이 필요하면 텍스트로 묻지 말고 이 툴을 호출하라.',
    alwaysLoad: true,
    tools,
  })

  return {
    server,
    tools,
    /** @returns {boolean} false when the gate id is unknown or already answered. */
    answer(id, value) {
      const entry = pending.get(id)
      if (!entry) return false
      pending.delete(id)
      entry.resolve(value)
      return true
    },
    /** Unblock every waiter so an aborted run cannot leave the process hanging. */
    cancelAll(reason) {
      for (const [id, entry] of pending) {
        pending.delete(id)
        entry.resolve(reason)
      }
    },
    listPending() {
      return [...pending.values()].map((e) => e.request)
    },
  }
}
