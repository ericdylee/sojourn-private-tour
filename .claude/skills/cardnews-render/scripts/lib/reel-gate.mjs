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
 * forbids the derivative that putting type over a photo already is. */
const BLOCKING = /\b(BY-SA|SA\b|ShareAlike|NC\b|NonCommercial|ND\b|NoDeriv)/i;

/* Recognised, unencumbered provenance. Anything not matching is unknown, and
 * unknown is treated as blocking.
 *
 * "CC BY \d" cannot match "CC BY-SA 2.0" — the digit must follow the space —
 * but BLOCKING is tested first anyway, so the two rules cannot disagree. */
const CLEAR = /(^(own\b|ai:))|\b(CC0|public domain|CC BY \d(\.\d)?|unsplash)\b/i;

export async function decideGate({ qaReportPath, rights = [] }) {
  const reasons = [];

  let verdict = null;
  try {
    const md = await readFile(qaReportPath, 'utf8');
    // The report is newest-first; the first verdict line is the current one.
    const m = md.match(/\*\*판정:\s*([A-Z]+)/);
    verdict = m ? m[1] : null;
  } catch {
    reasons.push(`QA — ${qaReportPath}를 읽을 수 없다`);
  }

  if (verdict === null && reasons.length === 0) {
    reasons.push('QA — 판정 줄을 찾지 못했다 (fail-closed)');
  } else if (verdict && verdict !== 'PASS') {
    reasons.push(`QA — 최신 판정이 ${verdict}다`);
  }

  for (const r of rights) {
    const s = r ?? '';
    if (BLOCKING.test(s)) {
      reasons.push(`LICENCE — "${s}"는 재배포에 조건이 붙는다`);
    } else if (!CLEAR.test(s)) {
      reasons.push(`LICENCE — "${s}"의 권리를 판정할 수 없다 (fail-closed)`);
    }
  }

  return { internal: reasons.length > 0, reasons };
}
