import { query } from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import { REPO_ROOT, displayPath } from './paths.mjs'
import { createGate, GATE_INSTRUCTIONS, GATE_TOOL_NAMES } from './gate.mjs'
import { agentPrompt } from './prompts.mjs'
import * as store from './runs.mjs'

const DEFAULT_MODEL = process.env.CAMPAIGN_MODEL || 'claude-opus-5'
const MAX_TURNS = Number(process.env.CAMPAIGN_MAX_TURNS || 600)

/**
 * The SDK reports a cancelled tool call by replacing its result with this
 * sentence. It is the only trace left: the stream keeps running, the lead
 * writes a tidy closing sentence, and the final `result` message still says
 * `subtype: "success"` — because from the model's point of view the turn did
 * finish. Nothing above this line knows a step was skipped.
 *
 * Observed once for real (run 2026-08-06T23-21-05, seq 107): a `card-producer`
 * delegation was cut mid-flight, the lead answered "위임을 중단했습니다", and the
 * console filed the whole thing as `done` · `success`. The HTML had been edited
 * and never re-rendered. Anyone reading the screen would have thought the card
 * was finished.
 */
/* Anchored, and the whole result — not a substring search.
 *
 * The sentinel *replaces* the result, so it is the entire content. A substring
 * test would also fire on a tool that merely printed the phrase, and this repo
 * is now a place where that happens: the string is written down in this file,
 * in `docs/PRD.md`, and in the recorded events under `web/.runs/`. An agent
 * grepping any of those would file its own run as interrupted, and a status
 * that cries wolf gets ignored exactly when it is right. */
const INTERRUPTION = /^\[Request interrupted[^\]]*\]$/i

/** True when a tool result is the SDK's cancellation sentinel rather than output. */
export function isInterruptionResult(text) {
  return INTERRUPTION.test(String(text ?? '').trim())
}

/**
 * The one place that decides how a finished run is filed.
 *
 * Pure, and exported, because the interesting cases are the ones that are hard
 * to stage live: an abort, a cancelled tool call, a turn limit. `done` has to
 * mean "ran to the end with nothing skipped" or the status line is decoration.
 *
 * Precedence is deliberate — an explicit abort is the most specific thing we
 * know, then a transport-level error, then a cancelled step, then whatever the
 * SDK called the ending.
 */
export function resolveFinalStatus({ aborted, interrupted, resultSubtype, resultIsError } = {}) {
  if (aborted) return 'stopped'
  if (resultIsError) return 'error'
  if (interrupted) return 'interrupted'
  // A `result` message arrived and named something other than a clean finish
  // (`error_max_turns`, `error_during_execution`, …). Trust it over `done`.
  if (resultSubtype && resultSubtype !== 'success') return 'interrupted'
  return 'done'
}

/** Trim a value for display without destroying the useful part of a path. */
function clip(value, max = 220) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  if (!s) return ''
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

function summarizeTool(name, input = {}) {
  switch (name) {
    // The harness reports subagent delegation as `Agent`; `Task` is the older
    // name and still shows up in some paths.
    case 'Agent':
    case 'Task':
      return clip([input.subagent_type, input.description].filter(Boolean).join(' — '))
    case 'Bash':
      return clip(input.command)
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return clip(displayPath(input.file_path))
    case 'Glob':
    case 'Grep':
      return clip([input.pattern, input.path && displayPath(input.path)].filter(Boolean).join('  in  '))
    case 'Skill':
      return clip(input.skill || input.name)
    case 'WebFetch':
    case 'WebSearch':
      return clip(input.url || input.query)
    case 'TodoWrite':
      return `${input.todos?.length ?? 0}개 항목`
    default:
      return clip(input.description || input.question || input.title || input.prompt || input)
  }
}

/**
 * One run = one agent. The console deliberately does not orchestrate the whole
 * campaign: a pipeline that rewrites the ledger and all four channels in one
 * unattended pass is the expensive thing to get wrong, and it is hard to stop
 * halfway. Chaining agents is the operator's call, one step at a time.
 *
 * The `busan-campaign` orchestrator still exists in the harness — an agent can
 * be told to use it. It just isn't a button.
 */
export class Run {
  constructor({ agent, instruction }) {
    this.id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8)
    this.mode = 'agent'
    this.agent = agent
    this.instruction = instruction
    this.model = DEFAULT_MODEL

    this.status = 'starting'
    this.startedAt = Date.now()
    this.endedAt = null
    this.error = null
    this.result = null
    this.costUsd = 0
    this.numTurns = 0
    this.sessionId = null
    this.harness = null
    /** @type {{at:number, tool:string|null, actor:string}|null} first cancelled step, if any */
    this.interrupted = null
    /** What the SDK called the ending — kept raw; `status` is our reading of it. */
    this.resultSubtype = null
    this.resultIsError = false

    this.seq = 0
    this.events = []
    this.subscribers = new Set()
    /** @type {Map<string, object>} live gate requests, mirrored to the UI */
    this.openGates = new Map()

    this.abort = new AbortController()
    /** tool_use_id → actor that owns it, so tool results land in the right lane */
    this.toolOwner = new Map()
    /** tool_use_id → tool name, so a cancelled result can name what was cut */
    this.toolName = new Map()
    /** tool_use_ids belonging to the gate server — rendered as cards, not tool rows */
    this.gateToolUses = new Set()

    this.gate = createGate({
      onRequest: (req) => {
        this.openGates.set(req.id, req)
        this.push({ type: 'gate.open', ...req })
      },
    })

    store.createRunDir(this.id)
    this.persistMeta()
  }

  get title() {
    return `${this.agent} — ${clip(this.instruction, 80)}`
  }

  persistMeta() {
    store.writeMeta(this.id, {
      id: this.id,
      mode: this.mode,
      agent: this.agent,
      instruction: this.instruction,
      title: this.title,
      model: this.model,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      error: this.error,
      costUsd: this.costUsd,
      numTurns: this.numTurns,
      eventCount: this.events.length,
      harness: this.harness,
      interrupted: this.interrupted,
      resultSubtype: this.resultSubtype,
    })
  }

  push(event) {
    const full = { seq: ++this.seq, t: Date.now(), ...event }
    this.events.push(full)
    store.appendEvent(this.id, full)
    const frame = `data: ${JSON.stringify(full)}\n\n`
    for (const res of this.subscribers) {
      try {
        res.write(frame)
      } catch {
        this.subscribers.delete(res)
      }
    }
    return full
  }

  subscribe(res) {
    this.subscribers.add(res)
    res.on('close', () => this.subscribers.delete(res))
  }

  answerGate(id, value) {
    const ok = this.gate.answer(id, value)
    if (!ok) return false
    const req = this.openGates.get(id)
    this.openGates.delete(id)
    this.push({ type: 'gate.answered', gateId: id, kind: req?.kind, value })
    return true
  }

  stop() {
    if (this.status !== 'running' && this.status !== 'starting') return false
    this.push({ type: 'run.stopping' })
    this.gate.cancelAll('사용자가 실행을 중단했다. 더 진행하지 말고 지금까지의 상태를 보고하라.')
    this.abort.abort()
    return true
  }

  /** SDKMessage → zero or more UI events. */
  ingest(msg) {
    if (msg.session_id && !this.sessionId) this.sessionId = msg.session_id

    if (msg.type === 'system' && msg.subtype === 'init') {
      this.harness = {
        model: msg.model,
        cwd: msg.cwd,
        agents: msg.agents || [],
        skills: msg.skills || [],
        mcpServers: (msg.mcp_servers || []).map((s) => `${s.name}:${s.status}`),
        toolCount: (msg.tools || []).length,
        permissionMode: msg.permissionMode,
      }
      this.push({ type: 'session.init', ...this.harness })
      this.persistMeta()
      return
    }

    if (msg.type === 'assistant') {
      const actor = msg.subagent_type || 'lead'
      for (const block of msg.message?.content || []) {
        if (block.type === 'text') {
          const text = (block.text || '').trim()
          if (text) this.push({ type: 'agent.text', actor, text })
        } else if (block.type === 'thinking') {
          this.push({ type: 'agent.thinking', actor })
        } else if (block.type === 'tool_use') {
          this.toolOwner.set(block.id, actor)
          this.toolName.set(
            block.id,
            block.name === 'Agent' || block.name === 'Task'
              ? `${block.name} → ${block.input?.subagent_type || '?'}`
              : block.name,
          )
          if (block.name?.startsWith('mcp__gate__')) {
            this.gateToolUses.add(block.id)
            continue // rendered as an approval card via gate.open
          }
          this.push({
            type: 'tool.use',
            actor,
            toolUseId: block.id,
            tool: block.name,
            summary: summarizeTool(block.name, block.input),
            delegateTo:
              block.name === 'Agent' || block.name === 'Task' ? block.input?.subagent_type || null : null,
          })
        }
      }
      if (msg.error) this.push({ type: 'agent.error', actor, error: msg.error })
      return
    }

    if (msg.type === 'user') {
      for (const block of msg.message?.content || []) {
        if (block.type !== 'tool_result') continue
        if (this.gateToolUses.has(block.tool_use_id)) continue
        const raw = Array.isArray(block.content)
          ? block.content.map((c) => c.text || `[${c.type}]`).join(' ')
          : block.content
        const actor = this.toolOwner.get(block.tool_use_id) || 'lead'
        this.push({
          type: 'tool.result',
          actor,
          toolUseId: block.tool_use_id,
          ok: !block.is_error,
          preview: clip(raw, 400),
        })
        // A cancelled step leaves no other trace. Record it now, while we still
        // know which tool it was — by the time the run ends the SDK will call
        // the whole thing a success.
        if (!this.interrupted && isInterruptionResult(raw)) {
          this.interrupted = {
            at: Date.now(),
            tool: this.toolName.get(block.tool_use_id) || null,
            actor,
          }
          this.push({
            type: 'notice',
            level: 'warn',
            text: `도구 호출이 중단됐다${this.interrupted.tool ? ` (${this.interrupted.tool})` : ''}. 이 실행은 끝까지 가지 않았다 — 산출물이 미완일 수 있다.`,
          })
        }
      }
      return
    }

    if (msg.type === 'result') {
      this.costUsd = msg.total_cost_usd ?? this.costUsd
      this.numTurns = msg.num_turns ?? this.numTurns
      this.result = typeof msg.result === 'string' ? msg.result : null
      this.resultSubtype = msg.subtype ?? null
      this.resultIsError = Boolean(msg.is_error)
      this.push({
        type: 'run.result',
        ok: !msg.is_error,
        subtype: msg.subtype,
        durationMs: msg.duration_ms,
        numTurns: this.numTurns,
        costUsd: this.costUsd,
        text: this.result,
      })
      return
    }

    // Everything else (status, retries, hooks, compaction) is diagnostic noise
    // for this console. Keep the few that explain a stall.
    if (msg.type === 'api_retry') {
      this.push({ type: 'notice', level: 'warn', text: `API 재시도 중 (${clip(msg.error, 120)})` })
    } else if (msg.type === 'compact_boundary') {
      this.push({ type: 'notice', level: 'info', text: '컨텍스트가 압축됐다' })
    }
  }

  async start() {
    this.status = 'running'
    const snapshot = await store.snapshotBefore(this.id).catch(() => [])
    this.push({
      type: 'run.started',
      agent: this.agent,
      instruction: this.instruction,
      model: this.model,
      snapshot,
    })
    this.persistMeta()

    const prompt = agentPrompt({ agent: this.agent, instruction: this.instruction })

    try {
      const stream = query({
        prompt,
        options: {
          cwd: REPO_ROOT,
          // The whole point: load .claude/agents, .claude/skills, .claude/settings.json
          // (incl. the guard.py PreToolUse hook) exactly as the terminal session does.
          settingSources: ['project'],
          model: this.model,
          maxTurns: MAX_TURNS,
          abortController: this.abort,
          mcpServers: { gate: this.gate.server },
          allowedTools: GATE_TOOL_NAMES,
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
            append: GATE_INSTRUCTIONS,
          },
          // Auto-approve tool use; guard.py still hard-blocks dangerous commands
          // at PreToolUse, which runs ahead of this callback.
          canUseTool: async (toolName, input) => {
            this.push({ type: 'tool.permission', tool: toolName, summary: summarizeTool(toolName, input) })
            return { behavior: 'allow', updatedInput: input }
          },
        },
      })

      for await (const msg of stream) this.ingest(msg)

      this.status = resolveFinalStatus({
        aborted: this.abort.signal.aborted,
        interrupted: Boolean(this.interrupted),
        resultSubtype: this.resultSubtype,
        resultIsError: this.resultIsError,
      })
    } catch (err) {
      if (this.abort.signal.aborted) {
        this.status = 'stopped'
      } else {
        this.status = 'error'
        this.error = err?.message || String(err)
        this.push({ type: 'run.error', message: this.error })
      }
    } finally {
      this.gate.cancelAll('실행이 종료됐다.')
      this.openGates.clear()
      this.endedAt = Date.now()
      this.push({
        type: 'run.ended',
        status: this.status,
        costUsd: this.costUsd,
        interrupted: this.interrupted,
        resultSubtype: this.resultSubtype,
      })
      this.persistMeta()
      for (const res of this.subscribers) {
        try {
          res.end()
        } catch {
          /* client already gone */
        }
      }
      this.subscribers.clear()
    }
    return this
  }
}
