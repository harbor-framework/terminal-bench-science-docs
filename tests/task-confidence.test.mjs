import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confidenceBounds,
  studentT95,
  taskConfidence,
  withTaskConfidenceIntervals,
} from '../lib/task-confidence.ts';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const outcomes = (counts) => counts.flatMap((count, solved) =>
  Array.from({ length: count }, () => ({ solved, total: 3 })));

test('Opus 5.5 task histogram matches an independent scipy calculation', () => {
  const stats = taskConfidence(outcomes([16, 9, 11, 34]));
  close(stats.accuracy, 63.33333333333333);
  close(stats.accuracy_stderr, 4.945062809790855);
  close(stats.accuracy_ci_lower, 53.46820295352375);
  close(stats.accuracy_ci_upper, 73.1984637131429);
  assert.equal(stats.accuracy_n_tasks, 70);
});

test('repeating the same outcomes does not create more independent tasks', () => {
  const original = outcomes([16, 9, 11, 34]);
  const duplicateAttempts = original.map((o) => ({ solved: o.solved * 2, total: o.total * 2 }));
  assert.deepEqual(taskConfidence(original), taskConfidence(duplicateAttempts));
  const reordered = taskConfidence([...original].reverse());
  close(reordered.accuracy_ci_lower, taskConfidence(original).accuracy_ci_lower);
});

test('each task has equal weight even with different numbers of attempts', () => {
  close(taskConfidence([{ solved: 1, total: 1 }, { solved: 0, total: 9 }]).accuracy, 50);
});

test('small domain and larger-sample t critical values match scipy references', () => {
  close(studentT95(7), 2.3646242510102993);
  close(studentT95(69), 1.994945415107237);
  close(studentT95(1000), 1.9623390808264074, 1e-8);
  assert.throws(() => studentT95(0));
});

test('insufficient data and identical task means do not imply exact certainty', () => {
  for (const data of [[], [{ solved: 1, total: 3 }]]) {
    const stats = taskConfidence(data);
    assert.equal(stats.accuracy_ci_status, 'insufficient_tasks');
    assert.equal(confidenceBounds(stats), null);
  }
  for (const solved of [0, 1, 3]) {
    const stats = taskConfidence(Array.from({ length: 8 }, () => ({ solved, total: 3 })));
    assert.equal(stats.accuracy_ci_status, 'no_variation');
    assert.equal(confidenceBounds(stats), null);
  }
});

test('bounded intervals preserve unequal distances from the mean near zero', () => {
  const stats = taskConfidence(outcomes([65, 4, 0, 1]));
  assert.equal(stats.accuracy_ci_lower, 0);
  close(stats.accuracy_ci_upper, 6.689076796067756);
});

test('overall and domain metrics derive from task cells while preserving accounting', () => {
  const stats = { accuracy: 50, accuracy_stderr: 1, total_cost_usd: 42, total_tokens: 500, passes: 3, tasks: 6 };
  const payload = {
    rows: [{ id: 'r', metrics: { ...stats, domain_metrics: { life: { ...stats }, earth: { ...stats, accuracy: 0 } } } }],
    task_matrix: {
      tasks: [{ id: 'a', domain: 'life' }, { id: 'b', domain: 'life' }],
      rows: { r: { a: { solved: 3, total: 3 }, b: { solved: 0, total: 3 } } },
    },
  };
  const result = withTaskConfidenceIntervals(payload).rows[0].metrics;
  assert.equal(result.accuracy, 50);
  assert.equal(result.total_cost_usd, 42);
  assert.equal(result.total_tokens, 500);
  assert.equal(result.accuracy_n_tasks, 2);
  assert.equal(result.domain_metrics.life.accuracy_ci_lower, result.accuracy_ci_lower);
  assert.equal(result.domain_metrics.earth.accuracy_ci_status, 'insufficient_tasks');
  assert.ok(result.display_accuracy.includes('95% CI'));
  assert.equal(payload.rows[0].metrics.accuracy_stderr, 1);
  payload.rows[0].metrics.accuracy = 90;
  assert.throws(() => withTaskConfidenceIntervals(payload), /disagree/);
});

test('invalid counts fail instead of manufacturing an interval', () => {
  for (const data of [[{ solved: 4, total: 3 }], [{ solved: -1, total: 3 }], [{ solved: 1, total: 0 }]]) {
    assert.throws(() => taskConfidence(data));
  }
});
