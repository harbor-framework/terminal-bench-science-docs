// Run with Node >=22.6: node --experimental-strip-types --test tests/leaderboard-cost.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  fetchLeaderboard,
  formatLeaderboardCost,
  formatLeaderboardCostMetrics,
  projectLeaderboardRowsToDomain,
  rankLeaderboardRowsByEfficiency,
} from '../lib/leaderboard.ts';

const metric = (cost) => ({
  tasks: 3,
  passes: 1,
  accuracy: 100 / 3,
  accuracy_stderr: 0.1,
  total_tokens: 12345,
  total_cost_usd: cost,
  display_accuracy: '33.3%',
  display_total_tokens: '12.3k',
  display_cost: 'legacy label',
});

const row = (id, cost) => ({
  id,
  leaderboard_id: 'board',
  rank: null,
  metadata: {},
  metrics: metric(cost),
  status: 'display',
  created_at: '',
  updated_at: '',
  n_trials: 3,
});

test('costs use nearest whole dollars, grouping and no compact suffix', () => {
  for (const [value, expected] of [
    [0, '$0'], [-0, '$0'], [0.49, '$0'], [0.5, '$1'], [2.5, '$3'],
    [385.933474254, '$386'], [999.5, '$1,000'],
    [6247.1398385, '$6,247'], [14175.948185250001, '$14,176'],
  ]) {
    assert.equal(formatLeaderboardCost(value), expected);
  }
});

test('unknown or invalid costs are not represented as zero', () => {
  for (const value of [null, undefined, true, '123', NaN, Infinity, -1]) {
    assert.equal(formatLeaderboardCost(value), null);
    const metrics = { total_cost_usd: value, display_cost: '—' };
    assert.deepEqual(formatLeaderboardCostMetrics(metrics), metrics);
  }
});

test('overall and domain labels change without mutating precise data', () => {
  const input = {
    ...metric(1234.567),
    domain_metrics: { life: metric(123.75), earth: metric(0), unknown: null },
  };
  const original = structuredClone(input);
  const output = formatLeaderboardCostMetrics(input);
  assert.deepEqual(input, original);
  assert.equal(output.display_cost, '$1,235');
  assert.equal(output.domain_metrics.life.display_cost, '$124');
  assert.equal(output.domain_metrics.earth.display_cost, '$0');
  assert.equal(output.domain_metrics.unknown, null);
  const expected = structuredClone(input);
  expected.display_cost = '$1,235';
  expected.domain_metrics.life.display_cost = '$124';
  expected.domain_metrics.earth.display_cost = '$0';
  assert.deepEqual(output, expected);
  assert.deepEqual(formatLeaderboardCostMetrics(output), output);
});

test('domain views keep the rounded labels and exact subtotals', () => {
  const original = row('one', 1234.567);
  original.metrics.domain_metrics = { life: metric(123.75) };
  const formatted = { ...original, metrics: formatLeaderboardCostMetrics(original.metrics) };
  assert.equal(projectLeaderboardRowsToDomain([formatted], 'all')[0].metrics.display_cost, '$1,235');
  const life = projectLeaderboardRowsToDomain([formatted], 'life')[0];
  assert.equal(life.metrics.display_cost, '$124');
  assert.equal(life.metrics.total_cost_usd, 123.75);
});

test('ranking still separates costs that display as the same dollar', () => {
  const rows = [row('a', 10.4), row('z', 10.1)].map((item) => ({
    ...item, metrics: formatLeaderboardCostMetrics(item.metrics),
  }));
  assert.deepEqual(rows.map((item) => item.metrics.display_cost), ['$10', '$10']);
  assert.deepEqual(rankLeaderboardRowsByEfficiency(rows).map((item) => item.id), ['z', 'a']);
});

test('fetch normalizes legacy overall and derived-domain labels', async (t) => {
  const original = row('one', 6247.1398385);
  original.metrics.domain_metrics = { life: metric(1109.489021) };
  const payload = { leaderboard: { columns: [] }, rows: [original], task_matrix: { tasks: [], rows: {} } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload)));
  const result = await fetchLeaderboard('org/package', 'board');
  assert.equal(result.rows[0].metrics.display_cost, '$6,247');
  assert.equal(result.rows[0].metrics.domain_metrics.life.display_cost, '$1,109');
  assert.equal(result.rows[0].metrics.total_cost_usd, 6247.1398385);
  assert.deepEqual(result.task_matrix, payload.task_matrix);
});
