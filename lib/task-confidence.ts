import type { LeaderboardReadResponse } from './leaderboard';

// Two-sided 95% Student t critical values (df 1..100), generated with
// scipy.stats.t.ppf(0.975, df). Larger df use the large-df expansion below.
const T_95: readonly (number | null)[] = [
  null,
  12.706204736432095,
  4.302652729696142,
  3.182446305284263,
  2.7764451051977987,
  2.570581835636314,
  2.4469118511449692,
  2.3646242515927844,
  2.306004135204166,
  2.2621571628540993,
  2.2281388519649385,
  2.200985160082949,
  2.1788128296634177,
  2.1603686564610127,
  2.1447866879169273,
  2.131449545559323,
  2.1199052992210112,
  2.1098155778331806,
  2.10092204024096,
  2.093024054408263,
  2.0859634472658364,
  2.079613844727662,
  2.0738730679040147,
  2.0686576104190406,
  2.0638985616280205,
  2.059538552753294,
  2.055529438642871,
  2.0518305164802833,
  2.048407141795244,
  2.045229642132703,
  2.0422724563012373,
  2.0395134463964077,
  2.036933343460101,
  2.0345152974493383,
  2.032244509317718,
  2.0301079282503425,
  2.0280940009804502,
  2.0261924630291093,
  2.024394163911969,
  2.0226909200367604,
  2.0210753903062733,
  2.019540970441376,
  2.018081702818444,
  2.016692199227824,
  2.0153675744437636,
  2.014103388880846,
  2.0128955989194286,
  2.0117405137297655,
  2.010634757624232,
  2.0095752371292397,
  2.008559112100761,
  2.007583770315836,
  2.006646805061688,
  2.0057459953178687,
  2.004879288188057,
  2.004044783289146,
  2.003240718847872,
  2.002465459291007,
  2.0017174841452356,
  2.0009953780882674,
  2.00029782201426,
  1.9996235849949393,
  1.9989715170333786,
  1.998340542520741,
  1.9977296543176926,
  1.9971379083920033,
  1.9965644189523113,
  1.9960083540252962,
  1.9954689314298435,
  1.9949454151072374,
  1.994437111771186,
  1.993943367845625,
  1.9934635666618716,
  1.992997125889855,
  1.9925434951809322,
  1.9921021540022417,
  1.9916726096446642,
  1.9912543953883843,
  1.9908470688116904,
  1.9904502102301282,
  1.9900634212544457,
  1.9896863234569024,
  1.9893185571365721,
  1.9889597801751624,
  1.9886096669757087,
  1.9882679074772216,
  1.9879342062390202,
  1.9876082815890703,
  1.987289864831169,
  1.986978699506281,
  1.9866745407037676,
  1.9863771544186173,
  1.98608631695113,
  1.9858018143458234,
  1.985523441866604,
  1.9852510035091888,
  1.9849843115310182,
  1.9847231860271193,
  1.984467454426692,
  1.9842169515086827,
  1.9839715184496334
];

export type TaskOutcome = { solved: number; total: number };
export type ConfidenceBounds = { lower: number; upper: number };
export type TaskConfidence = {
  accuracy: number | null;
  accuracy_stderr: number | null;
  accuracy_n_tasks: number;
  accuracy_ci_lower: number | null;
  accuracy_ci_upper: number | null;
  accuracy_ci_level: number;
  accuracy_ci_method: 'task_mean_student_t';
  accuracy_ci_status: 'estimated' | 'insufficient_tasks' | 'no_variation';
};

export function studentT95(df: number): number {
  if (!Number.isInteger(df) || df < 1) {
    throw new Error('Student t degrees of freedom must be a positive integer');
  }
  const tabulated = T_95[df];
  if (tabulated != null) return tabulated;
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * df)
    + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2)
    + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

/** Equal weight per task; attempts within a task are averaged first. */
export function taskConfidence(outcomes: readonly TaskOutcome[]): TaskConfidence {
  for (const outcome of outcomes) {
    if (!Number.isInteger(outcome.total) || !Number.isInteger(outcome.solved)
      || outcome.total < 0 || outcome.solved < 0 || outcome.solved > outcome.total) {
      throw new Error('Invalid binary trial counts');
    }
  }
  const means = outcomes.filter((o) => o.total > 0).map((o) => o.solved / o.total);
  const n = means.length;
  const mean = n ? means.reduce((sum, value) => sum + value, 0) / n : null;
  const sumSquares = mean == null ? 0 : means.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const se = n >= 2 ? 100 * Math.sqrt(sumSquares / (n * (n - 1))) : null;
  const noVariation = n >= 2 && means.every((value) => value === means[0]);
  const status = n < 2 ? 'insufficient_tasks' : noVariation ? 'no_variation' : 'estimated';
  const accuracy = mean == null ? null : mean * 100;
  const half = status === 'estimated' && se != null ? studentT95(n - 1) * se : null;
  return {
    accuracy,
    accuracy_stderr: noVariation ? 0 : se,
    accuracy_n_tasks: n,
    accuracy_ci_lower: half == null || accuracy == null ? null : Math.max(0, accuracy - half),
    accuracy_ci_upper: half == null || accuracy == null ? null : Math.min(100, accuracy + half),
    accuracy_ci_level: 0.95,
    accuracy_ci_method: 'task_mean_student_t',
    accuracy_ci_status: status,
  };
}

export function confidenceBounds(metrics: Record<string, unknown>): ConfidenceBounds | null {
  const lower = metrics.accuracy_ci_lower;
  const upper = metrics.accuracy_ci_upper;
  if (metrics.accuracy_ci_status !== 'estimated'
    || typeof lower !== 'number' || !Number.isFinite(lower)
    || typeof upper !== 'number' || !Number.isFinite(upper)
    || lower < 0 || upper > 100 || lower > upper) return null;
  return { lower, upper };
}

export function confidenceLabel(metrics: Record<string, unknown>, digits = 1): string {
  const bounds = confidenceBounds(metrics);
  return bounds ? `${bounds.lower.toFixed(digits)}–${bounds.upper.toFixed(digits)}%` : 'unavailable';
}

function withConfidence(metrics: Record<string, unknown>, outcomes: readonly TaskOutcome[]) {
  const stats = taskConfidence(outcomes);
  // Keep existing scores/accounting intact. Unequal task weights require an
  // explicit score-policy change, not silently moving the CI's centre.
  if (stats.accuracy != null && typeof metrics.accuracy === 'number'
    && Math.abs(stats.accuracy - metrics.accuracy) > 1e-8) {
    throw new Error('Task averages disagree with the recorded resolution rate');
  }
  const merged = { ...metrics, ...stats, accuracy: metrics.accuracy };
  const score = typeof merged.accuracy === 'number' ? merged.accuracy.toFixed(1) : '—';
  return { ...merged, display_accuracy: `**${score}%** (95% CI ${confidenceLabel(merged)})` };
}

/** Derive both overall and domain uncertainty from the same task matrix. */
export function withTaskConfidenceIntervals(response: LeaderboardReadResponse): LeaderboardReadResponse {
  const matrix = response.task_matrix;
  const domains = new Map(matrix?.tasks.map((task) => [task.id, task.domain]) ?? []);
  return {
    ...response,
    rows: response.rows.map((row) => {
      const cells = matrix?.rows[row.id] ?? {};
      const metrics = withConfidence(row.metrics, Object.values(cells));
      const originalDomains = row.metrics.domain_metrics;
      if (originalDomains && typeof originalDomains === 'object' && !Array.isArray(originalDomains)) {
        const domainMetrics = Object.fromEntries(Object.entries(originalDomains).map(([domain, metric]) => {
          const outcomes = Object.entries(cells).filter(([id]) => domains.get(id) === domain).map(([, value]) => value);
          return [domain, withConfidence(metric as Record<string, unknown>, outcomes)];
        }));
        return { ...row, metrics: { ...metrics, domain_metrics: domainMetrics } };
      }
      return { ...row, metrics };
    }),
  };
}
