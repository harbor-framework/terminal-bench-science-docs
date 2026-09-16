import type { DomainId } from '@/lib/domain-context';

export type JsonObject = Record<string, unknown>;

export type LeaderboardColumnType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'markdown'
  | 'link';

export type LeaderboardColumn = {
  id: string;
  header: string;
  accessor: string;
  type: LeaderboardColumnType;
  display_accessor?: string | null;
  display_type?: LeaderboardColumnType | null;
  align?: 'left' | 'center' | 'right';
  description?: string;
  enable_sorting?: boolean | null;
};

export type LeaderboardRow = {
  id: string;
  leaderboard_id: string;
  rank: number | null;
  metadata: JsonObject;
  metrics: JsonObject;
  status: 'display' | 'hide';
  created_at: string;
  updated_at: string;
  n_trials: number;
};

export type LeaderboardDomainMetric = {
  tasks: number;
  passes: number;
  accuracy: number;
  accuracy_stderr: number;
  total_tokens: number;
  total_cost_usd: number;
  display_accuracy: string;
  display_total_tokens: string;
  display_cost: string;
};

export type LeaderboardDomainMetrics = Record<
  Exclude<DomainId, 'all'>,
  LeaderboardDomainMetric
>;

export type LeaderboardMatrixTask = {
  id: string;
  slug: string;
  domain: Exclude<DomainId, 'all'>;
};

export type LeaderboardTaskOutcome = {
  solved: number;
  total: number;
};

export type LeaderboardTaskMatrix = {
  tasks: LeaderboardMatrixTask[];
  rows: Record<string, Record<string, LeaderboardTaskOutcome>>;
};

export type LeaderboardReadResponse = {
  leaderboard: {
    id: string;
    package_id: string;
    package: string | null;
    dataset_version_ids: string[];
    name: string;
    title: string;
    description: string | null;
    columns: LeaderboardColumn[];
    visibility: 'public' | 'private';
    created_at: string;
    updated_at: string;
  };
  rows: LeaderboardRow[];
  task_matrix?: LeaderboardTaskMatrix;
  pagination?: {
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
  };
};

export const TERMINAL_BENCH_PACKAGE =
  'terminal-bench-science/terminal-bench-science';
/** Hub path is org/package/leaderboard — board name (not `main`). */
export const TERMINAL_BENCH_LEADERBOARD = 'v0-1-eval';
export const HARBOR_HUB_URL = 'https://hub.harborframework.com';
/** Public Harbor Hub edge-function host (leaderboard-read does not require auth). */
export const HARBOR_HUB_FUNCTIONS_URL =
  'https://ofhuhcpkvzjlejydnvyd.supabase.co';

const COST_FORMAT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatLeaderboardCost(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return COST_FORMAT.format(value === 0 ? 0 : value);
}

/** Format labels only; keep precise costs for aggregation, sorting and charts. */
export function formatLeaderboardCostMetrics(metrics: JsonObject): JsonObject {
  const displayCost = formatLeaderboardCost(metrics.total_cost_usd);
  const domains = metrics.domain_metrics;
  return {
    ...metrics,
    ...(displayCost === null ? {} : { display_cost: displayCost }),
    ...(domains && typeof domains === 'object' && !Array.isArray(domains)
      ? {
          domain_metrics: Object.fromEntries(
            Object.entries(domains).map(([domain, metric]) => [
              domain,
              metric && typeof metric === 'object' && !Array.isArray(metric)
                ? formatLeaderboardCostMetrics(metric as JsonObject)
                : metric,
            ]),
          ),
        }
      : {}),
  };
}

export const leaderboardQueryKey = (
  packageName: string,
  name: string,
) => ['leaderboard', packageName, name] as const;

/** Harbor Hub dataset page for a package. */
export function harborDatasetUrl(
  packageName: string,
  version = 'latest',
): string {
  const [org, name] = packageName.split('/');
  return `${HARBOR_HUB_URL}/datasets/${encodeURIComponent(org)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

/** Harbor Hub detail page for a leaderboard row. */
export function harborLeaderboardRowUrl(
  packageName: string,
  leaderboardName: string,
  rowId: string,
  version = 'latest',
): string {
  const [org, name] = packageName.split('/');
  return `${HARBOR_HUB_URL}/datasets/${encodeURIComponent(org)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}/leaderboards/${encodeURIComponent(leaderboardName)}/rows/${encodeURIComponent(rowId)}`;
}

export async function fetchLeaderboard(
  packageName: string,
  name: string,
): Promise<LeaderboardReadResponse> {
  const params = new URLSearchParams({
    package: packageName,
    name,
  });
  const response = await fetch(
    `/api/leaderboard?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    },
  );

  const payload = (await response.json()) as
    | LeaderboardReadResponse
    | { error?: { message?: string; code?: string } };

  if (!response.ok) {
    const message =
      'error' in payload && payload.error?.message
        ? payload.error.message
        : `leaderboard-read failed (${response.status})`;
    throw new Error(message);
  }

  const leaderboardPayload = payload as LeaderboardReadResponse;
  return {
    ...leaderboardPayload,
    rows: rankLeaderboardRowsByEfficiency(
      leaderboardPayload.rows.map((row) => ({
        ...row,
        metrics: formatLeaderboardCostMetrics(row.metrics),
      })),
    ),
    leaderboard: {
      ...leaderboardPayload.leaderboard,
      columns: leaderboardPayload.leaderboard.columns.map((column) =>
        column.id === 'model_release_date'
          ? { ...column, type: 'date' as const }
          : column,
      ),
    },
  };
}

export function getAccessorValue(
  row: LeaderboardRow,
  accessor: string,
): unknown {
  const [root, ...path] = accessor.split('.');
  let value: unknown =
    root === 'metadata'
      ? row.metadata
      : root === 'metrics'
        ? row.metrics
        : null;

  for (const segment of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    value = (value as JsonObject)[segment];
  }

  return value;
}

function isDomainMetric(value: unknown): value is LeaderboardDomainMetric {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const metric = value as Partial<LeaderboardDomainMetric>;
  return (
    typeof metric.tasks === 'number' &&
    typeof metric.passes === 'number' &&
    typeof metric.accuracy === 'number' &&
    typeof metric.accuracy_stderr === 'number' &&
    typeof metric.total_tokens === 'number' &&
    typeof metric.total_cost_usd === 'number' &&
    typeof metric.display_accuracy === 'string' &&
    typeof metric.display_total_tokens === 'string' &&
    typeof metric.display_cost === 'string'
  );
}

function numericRowMetric(
  row: LeaderboardRow,
  accessor: string,
  fallback: number,
): number {
  const value = getAccessorValue(row, accessor);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function compareNumbers(left: number, right: number): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function rankLeaderboardRowsByEfficiency(
  rows: LeaderboardRow[],
): LeaderboardRow[] {
  return [...rows]
    .sort((left, right) => {
      const accuracyDelta = compareNumbers(
        numericRowMetric(right, 'metrics.accuracy', -Infinity),
        numericRowMetric(left, 'metrics.accuracy', -Infinity),
      );
      if (accuracyDelta !== 0) return accuracyDelta;

      const costDelta = compareNumbers(
        numericRowMetric(left, 'metrics.total_cost_usd', Infinity),
        numericRowMetric(right, 'metrics.total_cost_usd', Infinity),
      );
      if (costDelta !== 0) return costDelta;

      const tokenDelta = compareNumbers(
        numericRowMetric(left, 'metrics.total_tokens', Infinity),
        numericRowMetric(right, 'metrics.total_tokens', Infinity),
      );
      if (tokenDelta !== 0) return tokenDelta;

      return left.id.localeCompare(right.id);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function projectLeaderboardRowsToDomain(
  rows: LeaderboardRow[],
  domain: DomainId,
): LeaderboardRow[] {
  if (domain === 'all') return rankLeaderboardRowsByEfficiency(rows);

  const projectedRows = rows
    .flatMap((row) => {
      const domainMetrics = row.metrics.domain_metrics;
      if (
        typeof domainMetrics !== 'object' ||
        domainMetrics === null ||
        Array.isArray(domainMetrics)
      ) {
        return [];
      }
      const metric = (domainMetrics as JsonObject)[domain];
      if (!isDomainMetric(metric)) return [];
      return [
        {
          ...row,
          metrics: {
            ...row.metrics,
            ...metric,
          },
          n_trials: metric.tasks,
        },
      ];
    });

  return rankLeaderboardRowsByEfficiency(projectedRows);
}

export type LeaderboardLinkValue = {
  url: string;
  label: string;
};

export function parseLeaderboardLink(
  value: unknown,
): LeaderboardLinkValue | null {
  if (typeof value !== 'object' || value === null) return null;
  const url = 'url' in value ? (value as { url: unknown }).url : null;
  const label = 'label' in value ? (value as { label: unknown }).label : null;
  if (typeof url !== 'string' || !url) return null;
  if (typeof label !== 'string' || !label) return null;
  return { url, label };
}

export function formatLeaderboardCell(
  value: unknown,
  type: LeaderboardColumnType,
): string {
  if (value == null || value === '') return '—';

  switch (type) {
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'number': {
      if (typeof value !== 'number' || Number.isNaN(value)) return String(value);
      return Number.isInteger(value)
        ? value.toLocaleString('en-US')
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    case 'markdown':
      return String(value).replace(/\*\*(.*?)\*\*/g, '$1');
    case 'link': {
      const link = parseLeaderboardLink(value);
      return link?.label ?? String(value);
    }
    case 'date':
    case 'text':
      return String(value);
    default: {
      const _exhaustive: never = type;
      return String(_exhaustive);
    }
  }
}
