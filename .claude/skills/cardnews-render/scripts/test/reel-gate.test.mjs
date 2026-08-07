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
  const target = 'licensed:wikimedia/CC BY-SA 2.0 — bryan';
  const g = await decideGate({ qaReportPath: p, rights: [...CLEAN, target] });
  assert.equal(g.internal, true);
  // 리뷰어가 뮤테이션으로 잡아냈다: reasons가 입력 문자열을 그대로 echo하므로
  // /SA|ShareAlike/ 같은 느슨한 검사는 "재배포에 조건이 붙는다"(BLOCKING 경로)와
  // "판정할 수 없다"(unknown fallback 경로) 어느 쪽이 만든 사유든 통과해버려
  // BLOCKING이 통째로 사라져도 이 테스트는 초록불을 켠다. 사유 문구 자체를
  // 못박아 두 경로를 구분한다.
  assert.ok(
    g.reasons.some((r) => r.includes(target) && r.includes('재배포에 조건이 붙는다')),
    g.reasons.join(' / '),
  );
});

test('NonCommercial 사진이 섞이면 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const target = 'licensed:flickr/CC BY-NC 2.0 — someone';
  const g = await decideGate({ qaReportPath: p, rights: [target] });
  assert.equal(g.internal, true);
  assert.ok(
    g.reasons.some((r) => r.includes(target) && r.includes('재배포에 조건이 붙는다')),
    g.reasons.join(' / '),
  );
});

test('ND/SA는 라이선스 코드 문맥에서만 막는다 — 저작자 표기 끝의 이니셜(ND, SA)에 안 걸린다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const rights = [
    'licensed:flickr/CC BY 2.0 — Jane Doe, ND',
    'licensed:flickr/CC BY 2.0 — Sam Park, SA',
  ];
  const g = await decideGate({ qaReportPath: p, rights });
  assert.equal(g.internal, false, g.reasons.join(' / '));
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

// --- 리뷰 지적 사항 커버리지 -------------------------------------------
//
// CRITICAL 1: [A-Z]+ 캡처는 "**판정:" 뒤에 오는 첫 텍스트가 순수 대문자가
// 아니면 조용히 건너뛰고 더 아래의 옛 PASS를 채택한다. 실제 output/qa_report.md
// 에도 '**판정: 교체는 유효하다.**' 같은 한글 판정 줄이 존재한다(109행) — 오늘은
// 그 줄이 최신 HOLD보다 아래라서 우연히 안전할 뿐이다.

test('최신 판정이 한글 문장이고 그 아래 옛 PASS가 있으면 INTERNAL이다 (한글에 안 속는다)', async () => {
  const body =
    '# QA\n\n## 최신 (4회차)\n\n**판정: 교체는 유효하다.**\n\n' +
    '## 부록: 2회차\n\n**판정: PASS**\n';
  const p = await qaFile(body);
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true, g.reasons.join(' / '));
  assert.ok(
    g.reasons.some((r) => r.includes('교체는 유효하다.')),
    g.reasons.join(' / '),
  );
});

test('펜스 코드블록 안의 PASS 예시는 무시하고, 그 아래 진짜 HOLD를 본다', async () => {
  const body =
    '# QA\n\n예시 형식:\n\n```\n**판정: PASS**  (문서 예시 — 실제 판정 아님)\n```\n\n' +
    '## 3회차\n\n**판정: HOLD**   BLOCKER 1\n';
  const p = await qaFile(body);
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true, g.reasons.join(' / '));
  assert.ok(
    g.reasons.some((r) => /HOLD/.test(r)),
    g.reasons.join(' / '),
  );
});

test('PASS(조건부)는 PASS로 인정하지 않는다 — 사유가 원문을 인용한다', async () => {
  const p = await qaFile('**판정: PASS(조건부)**\n');
  const g = await decideGate({ qaReportPath: p, rights: CLEAN });
  assert.equal(g.internal, true);
  assert.ok(
    g.reasons.some((r) => r.includes('PASS(조건부)')),
    g.reasons.join(' / '),
  );
});

// CRITICAL 2: rights가 배열이 아니면(null/숫자/맨문자열) 던지지 않고 INTERNAL.

test('rights가 null이면 던지지 않고 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: null });
  assert.equal(g.internal, true);
  assert.ok(
    g.reasons.some((r) => r.includes('LICENCE') && r.includes('null')),
    g.reasons.join(' / '),
  );
});

test('rights가 맨 문자열이면 문자 단위로 쪼개지 않고 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: 'own' });
  assert.equal(g.internal, true);
  // 문자 단위로 쪼개졌다면 reasons에 "o"/"w"/"n" 같은 조각이 나온다 — 그런
  // 조각이 없어야 하고, 배열이 아니라는 사유 하나만 있어야 한다.
  assert.equal(g.reasons.length, 1, g.reasons.join(' / '));
  assert.ok(g.reasons[0].includes('LICENCE'));
  assert.ok(!/"o"|"w"|"n"/.test(g.reasons[0]), g.reasons[0]);
});

test('rights가 숫자면 던지지 않고 INTERNAL이다', async () => {
  const p = await qaFile('**판정: PASS**\n');
  const g = await decideGate({ qaReportPath: p, rights: 42 });
  assert.equal(g.internal, true);
  assert.ok(
    g.reasons.some((r) => r.includes('LICENCE') && r.includes('42')),
    g.reasons.join(' / '),
  );
});

// qaReportPath가 null이면 사유가 "null를 읽을 수 없다" 같은 어색한 문자열이
// 아니라 사람이 읽을 수 있는 형태여야 한다.

test('qaReportPath가 null이면 던지지 않고 사유가 사람이 읽을 수 있는 형태다', async () => {
  const g = await decideGate({ qaReportPath: null, rights: CLEAN });
  assert.equal(g.internal, true);
  assert.ok(!g.reasons.some((r) => r.includes('null를')), g.reasons.join(' / '));
  assert.ok(g.reasons.some((r) => r.includes('QA')), g.reasons.join(' / '));
});
