import { readFile } from 'node:fs/promises';

/**
 * Decides whether this render may leave the building.
 *
 * Fail-closed on purpose: the banner appears unless PASS can be positively
 * proven. qa_report.md is markdown and the parse can break; when it breaks the
 * safe side is the side with the banner on it.
 */

/* Any obligation that would follow the video downstream. SA forces the whole
 * reel under the same licence; NC forbids the commercial use this IS; ND
 * forbids the derivative that putting type over a photo already is.
 *
 * Matched only in licence-code context — BY-SA / BY-NC / BY-ND, or the
 * spelled-out names. Bare "SA"/"NC"/"ND" are dropped on purpose: they also
 * show up as somebody's initials in attribution free text
 * ("licensed:flickr/CC BY 2.0 — Jane Doe, ND"), and matching there would
 * block a clear CC BY credit for the wrong reason. This is safe to narrow —
 * CLEAR still can't match "CC BY-SA 2.0" (see below), so a string that slips
 * past BLOCKING falls through to the "unknown → fail-closed" branch, not to
 * open. BLOCKING exists only to give a *specific* reason for strings that
 * would otherwise look clear; it is not the only thing standing between an
 * encumbered photo and a false "clear". */
const BLOCKING = /\b(BY-SA|BY-NC|BY-ND|ShareAlike|NonCommercial|NoDerivatives?|NoDerivs?)/i;

/* Recognised, unencumbered provenance. Anything not matching is unknown, and
 * unknown is treated as blocking.
 *
 * "CC BY \d" cannot match "CC BY-SA 2.0" — the digit must follow the space —
 * but BLOCKING is tested first anyway, so the two rules cannot disagree. */
const CLEAR = /(^(own\b|ai:))|\b(CC0|public domain|CC BY \d(\.\d)?|unsplash)\b/i;

/** Verdicts we recognise as a deliberate, named non-pass (gets a short,
 * specific reason). Anything else that isn't PASS is unrecognised text —
 * Korean prose, a qualified "PASS(조건부)", an empty capture — and gets a
 * reason that quotes it verbatim so a human can see what confused the
 * parser. */
const KNOWN_NON_PASS = new Set(['HOLD']);

/** Strip fenced code blocks before looking for a verdict — a verdict sitting
 * inside a ```…``` documentation example is not a verdict. */
function stripCodeFences(md) {
  return md.replace(/```[\s\S]*?```/g, '');
}

/** Human-readable label for whatever `rights` turned out to be, when it
 * isn't the array the interface promises. */
function describeNotArray(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return `문자열 "${value}"`;
  if (typeof value === 'number') return `숫자 ${value}`;
  if (typeof value === 'boolean') return `불리언 ${value}`;
  return typeof value;
}

export async function decideGate({ qaReportPath, rights }) {
  const reasons = [];

  let verdictText = null; // trimmed text captured after "**판정:", null = not found at all
  let readError = false;
  try {
    const md = await readFile(qaReportPath, 'utf8');
    const clean = stripCodeFences(md);
    // The report is newest-first; the first verdict line is the current one.
    // Capture whatever follows "**판정:" up to the closing "**" or end of
    // line — not [A-Z]+, which silently skips any verdict that isn't a bare
    // ASCII-uppercase run (Korean prose, "PASS(조건부)", …) and lets an
    // older round's PASS further down the document get adopted instead.
    const m = clean.match(/\*\*판정:\s*(.*?)(?:\*\*|$)/m);
    verdictText = m ? m[1].trim() : null;
  } catch {
    readError = true;
    reasons.push(`QA — 리포트를 읽을 수 없다 (경로: ${qaReportPath ?? '(지정되지 않음)'})`);
  }

  if (!readError) {
    if (verdictText === null) {
      reasons.push('QA — 판정 줄을 찾지 못했다 (fail-closed)');
    } else if (verdictText === 'PASS') {
      // clearance positively proven — no reason
    } else if (KNOWN_NON_PASS.has(verdictText)) {
      reasons.push(`QA — 최신 판정이 ${verdictText}다`);
    } else {
      const shown = verdictText === '' ? '(비어 있음)' : verdictText;
      reasons.push(`QA — 최신 판정을 받아들일 수 없다: "${shown}" (PASS만 통과, fail-closed)`);
    }
  }

  const list = rights === undefined ? [] : rights;
  if (!Array.isArray(list)) {
    reasons.push(`LICENCE — rights가 배열이 아니다 — 받은 값: ${describeNotArray(list)} (fail-closed)`);
  } else {
    for (const r of list) {
      const s = r ?? '';
      if (BLOCKING.test(s)) {
        reasons.push(`LICENCE — "${s}"는 재배포에 조건이 붙는다`);
      } else if (!CLEAR.test(s)) {
        reasons.push(`LICENCE — "${s}"의 권리를 판정할 수 없다 (fail-closed)`);
      }
    }
  }

  return { internal: reasons.length > 0, reasons };
}
