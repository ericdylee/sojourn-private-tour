import { readFile } from 'node:fs/promises';

/* Reading speed, not equal division. Giving a three-word headline and a
 * nine-word one the same slot gets both wrong: one lingers, the other cuts off
 * mid-read. */
const LEAD_IN_MS = 400;
const PER_WORD_MS = 280;
const TAIL_MS = 500;
const MIN_MS = 2000;
const MAX_MS = 4500;

/* 4-5 scenes, not 6. Six cards at 15-25s is ~3s per scene with a two-line
 * headline, which is tight on a vertical screen. Which card to drop is an
 * editorial call made in step 1 and approved by a human. */
const MAX_SCENES = 5;
const MIN_SCENES = 3;

const REQUIRED = ['n', 'role', 'headline', 'photo', 'crop'];

export function wordCount(s) {
  return (s ?? '').trim().split(/\s+/).filter(Boolean).length;
}

export function sceneDuration({ headline, support }) {
  const words = wordCount(headline) + wordCount(support);
  const raw = LEAD_IN_MS + words * PER_WORD_MS + TAIL_MS;
  return Math.min(MAX_MS, Math.max(MIN_MS, Math.round(raw)));
}

export async function loadReelPlan(path) {
  const issues = [];
  let plan;
  try {
    plan = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    return { plan: null, issues: [`reel plan을 읽을 수 없다: ${path} — ${e.message}`] };
  }

  const scenes = plan.scenes ?? [];
  if (scenes.length > MAX_SCENES || scenes.length < MIN_SCENES) {
    issues.push(`씬이 ${scenes.length}개다 — 4~5개로 맞춰라 (허용 ${MIN_SCENES}~${MAX_SCENES})`);
  }

  for (const s of scenes) {
    for (const key of REQUIRED) {
      if (s[key] === undefined || s[key] === null || s[key] === '') {
        issues.push(`scene ${s.n ?? '?'}: 필수 필드 "${key}"가 없다`);
      }
    }
    if (s.duration_ms !== undefined && s.duration_ms !== null) {
      const isValid = typeof s.duration_ms === 'number' && Number.isFinite(s.duration_ms) && s.duration_ms > 0;
      if (!isValid) {
        issues.push(`scene ${s.n ?? '?'}: duration_ms는 양수여야 하는데 ${JSON.stringify(s.duration_ms)}이다`);
        s.duration_ms = undefined;
      }
    }
    if (s.duration_ms === undefined || s.duration_ms === null) {
      s.duration_ms = sceneDuration(s);
    }
  }

  const total = scenes.reduce((a, s) => a + (s.duration_ms ?? 0), 0);
  plan.total_ms = total;

  return { plan, issues };
}
