import 'server-only';
import { confidenceLabel, taskConfidence, withTaskConfidenceIntervals } from '@/lib/task-confidence';

import type {
  JsonObject,
  LeaderboardDomainMetric,
  LeaderboardDomainMetrics,
  LeaderboardReadResponse,
  LeaderboardRow,
  LeaderboardTaskMatrix,
  LeaderboardTaskOutcome,
} from '@/lib/leaderboard';

const DEFAULT_SUPABASE_URL = 'https://ofhuhcpkvzjlejydnvyd.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_Z-vuQbpvpG-PStjbh4yE0Q_e-d3MTIH';
const SCIENCE_DOMAINS = [
  'life',
  'physical',
  'earth',
  'mathematical',
  'engineering',
] as const;
const PAGE_SIZE = 1_000;
const QUERY_CHUNK_SIZE = 100;
const TOKEN_EXPIRY_SKEW_MS = 20_000;

type ScienceDomainId = (typeof SCIENCE_DOMAINS)[number];

type AccessTokenCache = {
  apiKey: string;
  accessToken: string;
  expiresAt: number;
};

type LeaderboardRowTrial = {
  row_id: string;
  trial_id: string;
};

type TrialModelRecord = {
  n_input_tokens: number | null;
  n_output_tokens: number | null;
  cost_usd: number | null;
};

type TrialRecord = {
  id: string;
  task_name: string;
  task_content_hash: string;
  rewards: JsonObject | null;
  trial_model: TrialModelRecord[];
};

type TaskVersionRecord = {
  content_hash: string;
  metadata: JsonObject | null;
};

type TaskClassification = {
  domain: ScienceDomainId;
};

let tokenCache: AccessTokenCache | null = null;

function supabaseUrl() {
  return process.env.HARBOR_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;
}

function publishableKey() {
  return (
    process.env.HARBOR_SUPABASE_PUBLISHABLE_KEY ??
    DEFAULT_SUPABASE_PUBLISHABLE_KEY
  );
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function exchangeApiKey(apiKey: string): Promise<string> {
  const response = await fetch(
    `${supabaseUrl()}/functions/v1/api-key-exchange`,
    {
      method: 'POST',
      headers: {
        apikey: publishableKey(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
      cache: 'no-store',
    },
  );
  const payload = (await response.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
    error?: { message?: unknown };
  };

  if (!response.ok || typeof payload.access_token !== 'string') {
    const message =
      typeof payload.error?.message === 'string'
        ? payload.error.message
        : `Harbor authentication failed (${response.status})`;
    throw new Error(message);
  }

  const expiresIn =
    typeof payload.expires_in === 'number' ? payload.expires_in : 0;
  tokenCache = {
    apiKey,
    accessToken: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1_000,
  };
  return payload.access_token;
}

async function getAccessToken(apiKey: string): Promise<string> {
  if (
    tokenCache?.apiKey === apiKey &&
    Date.now() < tokenCache.expiresAt - TOKEN_EXPIRY_SKEW_MS
  ) {
    return tokenCache.accessToken;
  }
  return exchangeApiKey(apiKey);
}

async function authenticatedFetch(
  apiKey: string,
  input: string,
  init?: RequestInit,
): Promise<Response> {
  let accessToken = await getAccessToken(apiKey);
  const request = (token: string) =>
    fetch(input, {
      ...init,
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      cache: 'no-store',
    });

  let response = await request(accessToken);
  if (response.status === 401) {
    tokenCache = null;
    accessToken = await getAccessToken(apiKey);
    response = await request(accessToken);
  }
  return response;
}

async function readJson<T>(
  apiKey: string,
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await authenticatedFetch(apiKey, input, init);
  const payload = (await response.json()) as
    | T
    | { error?: { message?: string }; message?: string };
  if (!response.ok) {
    const errorPayload = isObject(payload) ? payload : {};
    const nestedError = isObject(errorPayload.error)
      ? errorPayload.error
      : {};
    const message =
      (typeof nestedError.message === 'string' && nestedError.message) ||
      (typeof errorPayload.message === 'string' && errorPayload.message) ||
      `Harbor request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

async function readTablePage<T>(
  apiKey: string,
  table: string,
  params: URLSearchParams,
  start: number,
): Promise<T[]> {
  return readJson<T[]>(
    apiKey,
    `${supabaseUrl()}/rest/v1/${table}?${params.toString()}`,
    {
      headers: {
        Range: `${start}-${start + PAGE_SIZE - 1}`,
      },
    },
  );
}

async function readAllTableRows<T>(
  apiKey: string,
  table: string,
  params: URLSearchParams,
): Promise<T[]> {
  const result: T[] = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const page = await readTablePage<T>(apiKey, table, params, start);
    result.push(...page);
    if (page.length < PAGE_SIZE) return result;
  }
}

async function readLeaderboard(
  apiKey: string,
  packageName: string,
  leaderboardName: string,
): Promise<LeaderboardReadResponse> {
  return readJson<LeaderboardReadResponse>(
    apiKey,
    `${supabaseUrl()}/functions/v1/leaderboard-read`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        package: packageName,
        name: leaderboardName,
      }),
    },
  );
}

async function readRowTrials(
  apiKey: string,
  rowIds: string[],
): Promise<LeaderboardRowTrial[]> {
  const result: LeaderboardRowTrial[] = [];
  for (const rowIdChunk of chunks(rowIds, QUERY_CHUNK_SIZE)) {
    const params = new URLSearchParams({
      select: 'row_id,trial_id',
      row_id: `in.(${rowIdChunk.join(',')})`,
    });
    result.push(
      ...(await readAllTableRows<LeaderboardRowTrial>(
        apiKey,
        'leaderboard_row_trial',
        params,
      )),
    );
  }
  return result;
}

async function readTrials(
  apiKey: string,
  trialIds: string[],
): Promise<TrialRecord[]> {
  const result: TrialRecord[] = [];
  for (const trialIdChunk of chunks(trialIds, QUERY_CHUNK_SIZE)) {
    const params = new URLSearchParams({
      select:
        'id,task_name,task_content_hash,rewards,trial_model(n_input_tokens,n_output_tokens,cost_usd)',
      id: `in.(${trialIdChunk.join(',')})`,
    });
    result.push(
      ...(await readAllTableRows<TrialRecord>(apiKey, 'trial', params)),
    );
  }
  return result;
}

async function readTaskVersions(
  apiKey: string,
  contentHashes: string[],
): Promise<TaskVersionRecord[]> {
  const result: TaskVersionRecord[] = [];
  for (const hashChunk of chunks(contentHashes, QUERY_CHUNK_SIZE)) {
    const params = new URLSearchParams({
      select: 'content_hash,metadata',
      content_hash: `in.(${hashChunk.join(',')})`,
    });
    result.push(
      ...(await readAllTableRows<TaskVersionRecord>(
        apiKey,
        'task_version',
        params,
      )),
    );
  }
  return result;
}

function normalizeDomain(value: unknown): ScienceDomainId | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-sciences?$/, '');
  return (SCIENCE_DOMAINS as readonly string[]).includes(normalized)
    ? (normalized as ScienceDomainId)
    : null;
}

function buildTaskClassifications(
  taskVersions: TaskVersionRecord[],
): Map<string, TaskClassification> {
  const classifications = new Map<string, TaskClassification>();
  for (const version of taskVersions) {
    if (!isObject(version.metadata)) continue;
    const domain = normalizeDomain(version.metadata.domain);
    if (!domain) continue;
    const classification = { domain };
    const existing = classifications.get(version.content_hash);
    if (existing && existing.domain !== classification.domain) {
      throw new Error(
        `Task content hash ${version.content_hash} has conflicting domain metadata`,
      );
    }
    classifications.set(version.content_hash, classification);
  }
  return classifications;
}

function numericReward(rewards: JsonObject | null): number | null {
  if (!rewards) return null;
  if (typeof rewards.reward === 'number') return rewards.reward;
  for (const key of Object.keys(rewards).sort()) {
    const value = rewards[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

function taskSlug(taskName: string): string {
  return taskName.split('/').at(-1) ?? taskName;
}

function compactTokens(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function compactCost(value: number): string {
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2).replace(/\.?0+$/, '')}k`;
  }
  return `$${value.toFixed(2)}`;
}

function aggregateTrials(trials: TrialRecord[]): LeaderboardDomainMetric {
  const tasks = trials.length;
  const passes = trials.reduce(
    (total, trial) => total + (numericReward(trial.rewards) === 1 ? 1 : 0),
    0,
  );
  const outcomes = new Map<string, LeaderboardTaskOutcome>();
  for (const trial of trials) {
    const key = taskSlug(trial.task_name);
    const outcome = outcomes.get(key) ?? { solved: 0, total: 0 };
    outcome.total += 1;
    if (numericReward(trial.rewards) === 1) outcome.solved += 1;
    outcomes.set(key, outcome);
  }
  const confidence = taskConfidence([...outcomes.values()]);
  const accuracy = confidence.accuracy ?? 0;
  const totalTokens = trials.reduce(
    (total, trial) =>
      total +
      trial.trial_model.reduce(
        (trialTotal, model) =>
          trialTotal +
          (model.n_input_tokens ?? 0) +
          (model.n_output_tokens ?? 0),
        0,
      ),
    0,
  );
  const totalCost = trials.reduce(
    (total, trial) =>
      total +
      trial.trial_model.reduce(
        (trialTotal, model) => trialTotal + (model.cost_usd ?? 0),
        0,
      ),
    0,
  );

  return {
    tasks,
    passes,
    ...confidence,
    accuracy,
    total_tokens: totalTokens,
    total_cost_usd: totalCost,
    display_accuracy: `**${accuracy.toFixed(1)}%** (95% CI ${confidenceLabel(confidence)})`,
    display_total_tokens: compactTokens(totalTokens),
    display_cost: compactCost(totalCost),
  };
}

function hasDerivedMetrics(row: LeaderboardRow): boolean {
  const domainMetrics = row.metrics.domain_metrics;
  return (
    isObject(domainMetrics) &&
    SCIENCE_DOMAINS.every((domain) => isObject(domainMetrics[domain]))
  );
}

async function addDerivedMetrics(
  apiKey: string,
  response: LeaderboardReadResponse,
): Promise<LeaderboardReadResponse> {
  if (response.rows.length === 0) {
    return {
      ...response,
      task_matrix: {
        tasks: [],
        rows: {},
      },
    };
  }
  if (response.task_matrix && response.rows.every(hasDerivedMetrics)) {
    return response;
  }

  const associations = await readRowTrials(
    apiKey,
    response.rows.map((row) => row.id),
  );
  const trialIds = [...new Set(associations.map((item) => item.trial_id))];
  const trials = await readTrials(apiKey, trialIds);
  const contentHashes = [
    ...new Set(trials.map((trial) => trial.task_content_hash)),
  ];
  const taskVersions = await readTaskVersions(apiKey, contentHashes);
  const classifications = buildTaskClassifications(taskVersions);
  const trialsById = new Map(trials.map((trial) => [trial.id, trial]));
  const taskDomains = new Map<string, ScienceDomainId>();
  const trialIdsByRow = new Map<string, string[]>();
  const matrixRows: LeaderboardTaskMatrix['rows'] = {};

  for (const trial of trials) {
    const slug = taskSlug(trial.task_name);
    const classification = classifications.get(trial.task_content_hash);
    if (!classification) {
      throw new Error(`Task ${trial.task_name} has no recognized domain metadata`);
    }
    const existingDomain = taskDomains.get(slug);
    if (existingDomain && existingDomain !== classification.domain) {
      throw new Error(
        `Task ${slug} has conflicting domain metadata across versions`,
      );
    }
    taskDomains.set(slug, classification.domain);
  }

  for (const association of associations) {
    const ids = trialIdsByRow.get(association.row_id) ?? [];
    ids.push(association.trial_id);
    trialIdsByRow.set(association.row_id, ids);
  }

  const rows = response.rows.map((row) => {
    const grouped = Object.fromEntries(
      SCIENCE_DOMAINS.map((domain) => [domain, [] as TrialRecord[]]),
    ) as Record<ScienceDomainId, TrialRecord[]>;
    const taskOutcomes: Record<string, LeaderboardTaskOutcome> = {};

    for (const trialId of trialIdsByRow.get(row.id) ?? []) {
      const trial = trialsById.get(trialId);
      if (!trial) {
        throw new Error(`Attached trial ${trialId} is not visible`);
      }
      const classification = classifications.get(trial.task_content_hash);
      if (!classification) {
        throw new Error(
          `Task ${trial.task_name} has no recognized domain metadata`,
        );
      }
      grouped[classification.domain].push(trial);
      const slug = taskSlug(trial.task_name);
      const outcome = taskOutcomes[slug] ?? {
        solved: 0,
        total: 0,
      };
      outcome.total += 1;
      if (numericReward(trial.rewards) === 1) outcome.solved += 1;
      taskOutcomes[slug] = outcome;
    }
    matrixRows[row.id] = taskOutcomes;

    if (hasDerivedMetrics(row)) return row;

    const domainMetrics = Object.fromEntries(
      SCIENCE_DOMAINS.map((domain) => [
        domain,
        aggregateTrials(grouped[domain]),
      ]),
    ) as LeaderboardDomainMetrics;

    return {
      ...row,
      metrics: {
        ...row.metrics,
        domain_metrics: domainMetrics,
      },
    };
  });

  const tasks = [...taskDomains.entries()]
    .map(([slug, domain]) => ({
      id: slug,
      slug,
      domain,
    }))
    .sort((left, right) => {
      const leftOutcomes = Object.values(matrixRows)
        .map((row) => row[left.id])
        .filter((outcome) => outcome && outcome.total > 0);
      const rightOutcomes = Object.values(matrixRows)
        .map((row) => row[right.id])
        .filter((outcome) => outcome && outcome.total > 0);
      const leftRate =
        leftOutcomes.reduce(
          (total, outcome) => total + outcome.solved / outcome.total,
          0,
        ) / leftOutcomes.length;
      const rightRate =
        rightOutcomes.reduce(
          (total, outcome) => total + outcome.solved / outcome.total,
          0,
        ) / rightOutcomes.length;
      const rateDelta = rightRate - leftRate;
      if (rateDelta !== 0) return rateDelta;

      const leftPasses = leftOutcomes.reduce(
        (total, outcome) => total + outcome.solved,
        0,
      );
      const rightPasses = rightOutcomes.reduce(
        (total, outcome) => total + outcome.solved,
        0,
      );
      return (
        rightPasses - leftPasses ||
        left.slug.localeCompare(right.slug) ||
        left.id.localeCompare(right.id)
      );
    });

  return {
    ...response,
    rows,
    task_matrix: {
      tasks,
      rows: matrixRows,
    },
  };
}

export async function readHarborLeaderboardWithDomains(
  apiKey: string,
  packageName: string,
  leaderboardName: string,
): Promise<LeaderboardReadResponse> {
  const response = await readLeaderboard(apiKey, packageName, leaderboardName);
  return withTaskConfidenceIntervals(await addDerivedMetrics(apiKey, response));
}
