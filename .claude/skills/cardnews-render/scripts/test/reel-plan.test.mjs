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
