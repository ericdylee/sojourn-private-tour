import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sceneDuration, loadReelPlan } from '../lib/reel-plan.mjs';

test('길이는 단어 수에서 나온다', () => {
  const short = sceneDuration({ headline: 'One two three', support: '' });
  const long = sceneDuration({ headline: 'A village that climbs', support: 'Gamcheon Culture Village, Busan' });
  assert.ok(long > short, '단어가 많으면 길어야 한다');
});

test('길이에 하한과 상한이 있다', () => {
  assert.equal(sceneDuration({ headline: 'Go', support: '' }), 2000);
  const wordy = Array.from({ length: 40 }, () => 'word').join(' ');
  assert.equal(sceneDuration({ headline: wordy, support: '' }), 4500);
});

test('duration_ms를 사람이 덮어쓸 수 있다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [
      { n: 1, role: 'hook', headline: 'A village that climbs', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: 9999 },
      { n: 2, role: 'cta', headline: 'Two words', support: '', photo: 'b.jpg', crop: '50% 50%', duration_ms: null },
      { n: 3, role: 'body', headline: 'Three more words', support: '', photo: 'c.jpg', crop: '50% 50%', duration_ms: null },
    ],
  }));
  const { plan, issues } = await loadReelPlan(p);
  assert.deepEqual(issues, []);
  assert.equal(plan.scenes[0].duration_ms, 9999, '사람이 적은 값을 그대로 쓴다');
  assert.equal(plan.scenes[1].duration_ms, sceneDuration(plan.scenes[1]), 'null이면 계산한다');
});

test('필수 필드가 없으면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [{ n: 1, role: 'hook', headline: 'Hi', support: '' }],
  }));
  const { issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /photo/.test(i)), `photo 누락을 잡아야 한다 — ${JSON.stringify(issues)}`);
  assert.ok(issues.some((i) => /crop/.test(i)), `crop 누락을 잡아야 한다 — ${JSON.stringify(issues)}`);
});

test('씬이 6개 이상이면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: Array.from({ length: 6 }, (_, i) => ({
      n: i + 1, role: 'body', headline: 'Two words', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: null,
    })),
  }));
  const { issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /4~5/.test(i)), `씬 수 상한을 잡아야 한다 — ${JSON.stringify(issues)}`);
});

test('duration_ms가 0이면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [
      { n: 1, role: 'hook', headline: 'Hi', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: 0 },
      { n: 2, role: 'body', headline: 'Two words', support: '', photo: 'b.jpg', crop: '50% 50%', duration_ms: 2000 },
      { n: 3, role: 'cta', headline: 'Three words ok', support: '', photo: 'c.jpg', crop: '50% 50%', duration_ms: null },
    ],
  }));
  const { plan, issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /duration_ms/.test(i)), `duration_ms 0을 잡아야 한다 — ${JSON.stringify(issues)}`);
  assert.equal(typeof plan.total_ms, 'number', 'total_ms는 항상 number여야 한다');
});

test('duration_ms가 문자열이면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [
      { n: 1, role: 'hook', headline: 'Hi', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: 'oops' },
      { n: 2, role: 'body', headline: 'Two words', support: '', photo: 'b.jpg', crop: '50% 50%', duration_ms: 2500 },
      { n: 3, role: 'cta', headline: 'Three words ok', support: '', photo: 'c.jpg', crop: '50% 50%', duration_ms: null },
    ],
  }));
  const { plan, issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /duration_ms/.test(i)), `duration_ms 문자열을 잡아야 한다 — ${JSON.stringify(issues)}`);
  assert.equal(typeof plan.total_ms, 'number', 'total_ms는 항상 number여야 한다');
});

// --- scenes 정규화 ------------------------------------------------------
//
// loadReelPlan이 scenes를 지역 변수로만 다루면, JSON에 scenes 키가 없을 때
// plan.scenes가 undefined인 채로 반환된다. 호출자(render-reel.mjs)는 곧바로
// plan.scenes.map을 부르므로 TypeError로 죽고, 이 함수가 이미 만들어 둔
// "씬이 0개다" issue는 화면에 닿지 못한다. 판정은 맞았는데 아무도 못 본다.

test('scenes 키가 없으면 plan.scenes가 빈 배열로 정규화되고 issue가 살아남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({ campaign_id: 'x', fps: 30 }));
  const { plan, issues } = await loadReelPlan(p);
  assert.ok(plan, 'plan은 null이 아니어야 한다');
  assert.deepEqual(plan.scenes, [], 'undefined가 아니라 빈 배열이어야 호출자가 안 죽는다');
  assert.equal(plan.total_ms, 0);
  assert.ok(issues.some((i) => /씬이 0개다/.test(i)), `씬 0개를 알려야 한다 — ${JSON.stringify(issues)}`);
});

test('scenes가 배열이 아니면 빈 배열로 정규화하고 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({ campaign_id: 'x', fps: 30, scenes: 'nope' }));
  const { plan, issues } = await loadReelPlan(p);
  assert.deepEqual(plan.scenes, [], '문자열을 그대로 두면 for...of가 글자 단위로 돈다');
  assert.ok(issues.some((i) => /scenes가 배열이 아니다/.test(i)), JSON.stringify(issues));
});

test('원장이 객체가 아니면 던지지 않고 plan:null로 떨어진다', async () => {
  for (const body of ['null', '42', '"hello"', '[]']) {
    const dir = await mkdtemp(join(tmpdir(), 'plan-'));
    const p = join(dir, 'plan.json');
    await writeFile(p, body);
    const { plan, issues } = await loadReelPlan(p);
    assert.equal(plan, null, `${body}에서 plan이 null이어야 한다`);
    assert.ok(issues.length > 0, `${body}에서 issue가 있어야 한다`);
  }
});

test('duration_ms가 음수면 issue를 낸다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'));
  const p = join(dir, 'plan.json');
  await writeFile(p, JSON.stringify({
    campaign_id: 'x', fps: 30,
    scenes: [
      { n: 1, role: 'hook', headline: 'Hi', support: '', photo: 'a.jpg', crop: '50% 50%', duration_ms: -100 },
      { n: 2, role: 'body', headline: 'Two words', support: '', photo: 'b.jpg', crop: '50% 50%', duration_ms: 2500 },
      { n: 3, role: 'cta', headline: 'Three words ok', support: '', photo: 'c.jpg', crop: '50% 50%', duration_ms: null },
    ],
  }));
  const { plan, issues } = await loadReelPlan(p);
  assert.ok(issues.some((i) => /duration_ms/.test(i)), `음수 duration_ms를 잡아야 한다 — ${JSON.stringify(issues)}`);
  assert.equal(typeof plan.total_ms, 'number', 'total_ms는 항상 number여야 한다');
});
