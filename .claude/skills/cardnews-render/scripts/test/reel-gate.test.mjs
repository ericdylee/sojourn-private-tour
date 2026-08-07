import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decideGate } from '../lib/reel-gate.mjs';

async function qaFile(body) {
  const dir = await mkdtemp(join(tmpdir(), 'qa-'));
  const p = join(dir, 'qa_report.md');
  await writeFile(p, body);
  return p;
}

const CLEAN = ['licensed:wikimedia/CC BY 4.0 — S h y numis', 'licensed:wikimedia/CC0 — VaneTrz20'];

test('QA가 PASS이고 권리가 깨끗하면 발행본이 나온다', async () => {
  const p = await qaFile('# QA\n\n## 4회차\n\n**판정: PASS**   BLOCKER 0\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, false, g.reasons.join(' / '));
});

test('QA가 HOLD면 INTERNAL이다', async () => {
  const p = await qaFile('# QA\n\n## 3회차\n\n**판정: HOLD**   BLOCKER 3\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true);
  assert.ok(g.reasons.some((r) => /QA/.test(r)));
});

test('최신 회차만 본다 — 아래 붙은 옛 PASS에 속지 않는다', async () => {
  const p = await qaFile('# QA\n\n## 3회차\n\n**판정: HOLD**   BLOCKER 3\n\n## 부록: 2회차\n\n**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true, '문서 첫 판정이 최신이다');
});

test('판정을 못 읽으면 INTERNAL이다 (fail-closed)', async () => {
  const p = await qaFile('# QA\n\n아직 판정이 없다.\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true);
});

test('QA 파일이 없으면 INTERNAL이다', async () => {
  const g = await decideGate({ qaReportPath: '/nope/qa_report.md', rights: CLEAN });
  assert.equal(g.internal, true);
});

test('ShareAlike 사진이 섞이면 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: [...CLEAN, 'licensed:wikimedia/CC BY-SA 2.0 — bryan'] });
  assert.equal(g.internal, true);
  assert.ok(g.reasons.some((r) => /SA|ShareAlike/i.test(r)));
});

test('NonCommercial 사진이 섞이면 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['licensed:flickr/CC BY-NC 2.0 — someone'] });
  assert.equal(g.internal, true);
});

test('모르는 권리 문자열이면 INTERNAL이다 (fail-closed)', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['어디선가 받음'] });
  assert.equal(g.internal, true);
});

test('자사 사진과 AI 개념컷은 통과한다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: ['own', 'ai:gpt-image-2'] });
  assert.equal(g.internal, false, g.reasons.join(' / '));
});

// 브리프에 없던 케이스: 매니페스트에 사진이 없는 씬은 rights 배열 항목이
// null/undefined로 들어온다. 던지지 않고 INTERNAL로 떨어져야 한다.
test('rights 항목이 null/undefined면 던지지 않고 INTERNAL이다 (매니페스트 누락)', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: [...CLEAN, undefined, null] });
  assert.equal(g.internal, true);
  assert.ok(g.reasons.some((r) => /LICENCE/.test(r)));
});
