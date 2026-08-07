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

/** Exposed purely for direct testing: whether `s` looks like recognised,
 * unencumbered provenance by itself — independent of BLOCKING and of check
 * order. decideGate always runs BLOCKING first and never calls this in
 * isolation, so this export exists only so a test can pin CLEAR's own
 * correctness (e.g. that it never matches a BY-SA/BY-NC/BY-ND string). Without
 * it, a future reorder of the two checks could silently let CLEAR alone
 * decide an encumbered licence is fine, and no test would notice. */
export function isClearRights(s) {
  return CLEAR.test(s ?? '');
}

/** Verdicts we recognise as a deliberate, named non-pass (gets a short,
 * specific reason). Anything else that isn't PASS is unrecognised text —
 * Korean prose, a qualified "PASS(조건부)", an empty capture — and gets a
 * reason that quotes it verbatim so a human can see what confused the
 * parser. */
const KNOWN_NON_PASS = new Set(['HOLD']);

/* A verdict line, anchored to the start of a (possibly indented) line, so
 * indentation can be inspected separately from the verdict text itself.
 * Captures: [1] leading whitespace, [2] whatever follows "**판정:" up to the
 * closing "**" or end of line. */
const VERDICT_LINE = /^([ \t]*)\*\*판정:\s*(.*?)(?:\*\*|$)/m;

/** Strip fenced code blocks — ``` or ~~~ — before looking for a verdict. A
 * verdict inside a documentation example is not a verdict, in either fence
 * style.
 *
 * Two passes:
 *  1. Balanced pairs: opener and closer must be the same fence character
 *     repeated the same number of times (3+), matched non-greedily so
 *     adjacent blocks don't merge into one.
 *  2. An unclosed opener left over after pass 1 is still a fence per
 *     CommonMark — it implicitly runs to the end of the document, there is
 *     no such thing as "half a fence". Leaving it unstripped would let a
 *     documentation example that forgot its closing marker read as plain
 *     text, and any verdict-shaped example inside it — or any real verdict
 *     that happens to sit below it — would be reachable again. Stripping to
 *     EOF is also the fail-closed direction if the missing marker really
 *     was authoring damage rather than an intentional block: better to lose
 *     a real verdict to "not found" than to trust text that a broken fence
 *     couldn't confirm was prose. */
function stripCodeFences(md) {
  let out = md.replace(/(`{3,}|~{3,})[\s\S]*?\1/g, '');
  out = out.replace(/(`{3,}|~{3,})[\s\S]*$/, '');
  return out;
}

/**
 * A rights entry is either a bare provenance string or `{rights, scene, photo}`.
 *
 * The descriptor form exists because the bare string produced a correct verdict
 * with a useless reason: a photo missing from the manifest arrives as `null`,
 * and the reason read `LICENCE — ""의 권리를 판정할 수 없다 (fail-closed)`. True,
 * and no way to tell which of five scenes to go fix. Only `rights` is ever
 * matched against BLOCKING/CLEAR — scene and photo are display-only, so a
 * filename that happens to contain "BY-SA" can never change a verdict.
 */
function normaliseRightsEntry(entry) {
  if (entry !== null && typeof entry === 'object' && !Array.isArray(entry)) {
    const scene = entry.scene ?? null;
    const photo = entry.photo ?? null;
    const where = [scene, photo ? `"${photo}"` : null].filter(Boolean).join(' ');
    return { text: entry.rights ?? '', where };
  }
  return { text: entry ?? '', where: '' };
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

  let verdictText = null; // trimmed text of an unambiguous verdict, or null if none found
  let ambiguousIndent = null; // trimmed text of a verdict we found but can't trust (see below)
  let readError = false;
  try {
    const md = await readFile(qaReportPath, 'utf8');
    const clean = stripCodeFences(md);
    // The report is newest-first; the first verdict line is the current one.
    // Capture whatever follows "**판정:" up to the closing "**" or end of
    // line — not [A-Z]+, which silently skips any verdict that isn't a bare
    // ASCII-uppercase run (Korean prose, "PASS(조건부)", …) and lets an
    // older round's PASS further down the document get adopted instead.
    const m = clean.match(VERDICT_LINE);
    if (m) {
      const [, indent, text] = m;
      // A line indented 4+ spaces (or a tab) is, per CommonMark, an indented
      // code block — *if* it follows a blank line and isn't a list-item
      // continuation. Telling those apart from here would need a real
      // Markdown parser. Rather than risk either failure mode — silently
      // trusting a documentation example, or silently discarding a verdict
      // a report author indented on purpose for visual grouping — treat it
      // as neither: it's not a verdict we can accept, and we don't keep
      // searching past it for another one either.
      if (indent.includes('\t') || indent.length >= 4) {
        ambiguousIndent = text.trim();
      } else {
        verdictText = text.trim();
      }
    }
  } catch {
    readError = true;
    reasons.push(`QA — 리포트를 읽을 수 없다 (경로: ${qaReportPath ?? '(지정되지 않음)'})`);
  }

  if (!readError) {
    if (ambiguousIndent !== null) {
      const shown = ambiguousIndent === '' ? '(비어 있음)' : ambiguousIndent;
      reasons.push(
        `QA — 판정 줄이 4칸 이상 들여쓰기돼 있어 코드블록인지 실제 판정인지 구분할 수 없다: "${shown}" (fail-closed)`,
      );
    } else if (verdictText === null) {
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
      const { text: s, where } = normaliseRightsEntry(r);
      const at = where ? `${where}: ` : '';
      if (BLOCKING.test(s)) {
        reasons.push(`LICENCE — ${at}"${s}"는 재배포에 조건이 붙는다`);
      } else if (!CLEAR.test(s)) {
        reasons.push(`LICENCE — ${at}"${s}"의 권리를 판정할 수 없다 (fail-closed)`);
      }
    }
  }

  return { internal: reasons.length > 0, reasons };
}
