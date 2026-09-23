'use client';

import Link from 'next/link';

import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  ArrowUpDownIcon,
  Copy01Icon,
  Tick02Icon,
  Image01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import type {
  Column,
  ColumnDef,
  OnChangeFn,
  VisibilityState,
} from '@tanstack/react-table';
import { toBlob } from 'html-to-image';
import { useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';

import { LeaderboardSkeleton } from '@/components/leaderboard/leaderboard-skeleton';
import {
  applyLeaderboardFilters,
  buildFilterFacets,
  LeaderboardToolbar,
  type LeaderboardFilters,
} from '@/components/leaderboard/leaderboard-toolbar';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ViewDescriptionBar } from '@/components/view-description-bar';
import { ViewHeader } from '@/components/view-header';
import { confidenceBounds, confidenceLabel } from '@/lib/task-confidence';
import {
  TERMINAL_BENCH_LEADERBOARD,
  TERMINAL_BENCH_PACKAGE,
  fetchLeaderboard,
  formatLeaderboardCell,
  getAccessorValue,
  harborLeaderboardRowUrl,
  leaderboardQueryKey,
  parseLeaderboardLink,
  projectLeaderboardRowsToDomain,
  type LeaderboardColumn,
  type LeaderboardColumnType,
  type LeaderboardRow,
} from '@/lib/leaderboard';
import {
  domainExportTitle,
  getDomain,
  type DomainId,
} from '@/lib/domain-context';
import {
  createExportClone,
  highResolutionExportScale,
  waitForExportImages,
} from '@/lib/export-view';
import {
  fromUrlFilters,
  hiddenColumnsParser,
  leaderboardFiltersParser,
  toUrlFilters,
} from '@/lib/leaderboard-url-state';
import { cn } from '@/lib/utils';

const SORTABLE_COLUMN_IDS = new Set([
  'accuracy',
  'release_date',
  'total_tokens',
  'total_cost_usd',
]);
const TABLE_IMAGE_ID = 'leaderboard-table-image';

function alignClass(align?: LeaderboardColumn['align']) {
  switch (align) {
    case 'center':
      return 'text-center';
    case 'right':
      return 'text-right';
    case 'left':
    case undefined:
      return 'text-left';
    default: {
      const _exhaustive: never = align;
      return _exhaustive;
    }
  }
}

function renderMarkdownInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    const match = /^\*\*([^*]+)\*\*$/.exec(part);
    if (match) {
      return <strong key={index}>{match[1]}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function LeaderboardCell({
  value,
  type,
}: {
  value: unknown;
  type: LeaderboardColumnType;
}) {
  if (value == null || value === '') return '—';

  switch (type) {
    case 'link': {
      const link = parseLeaderboardLink(value);
      if (!link) return formatLeaderboardCell(value, type);
      return (
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {link.label}
        </a>
      );
    }
    case 'markdown':
      return <>{renderMarkdownInline(String(value))}</>;
    case 'boolean':
    case 'number':
    case 'date':
    case 'text':
      return formatLeaderboardCell(value, type);
    default: {
      const _exhaustive: never = type;
      return String(_exhaustive);
    }
  }
}

function AccuracyBarCell({
  row,
  accentColor,
}: {
  row: LeaderboardRow;
  accentColor: string;
}) {
  const accuracy = getAccessorValue(row, 'metrics.accuracy');
  const display = getAccessorValue(row, 'metrics.display_accuracy');

  const value =
    typeof accuracy === 'number' && !Number.isNaN(accuracy) ? accuracy : null;
  const interval = confidenceBounds(row.metrics);
  const label = confidenceLabel(row.metrics);
  const nTasks = row.metrics.accuracy_n_tasks;

  if (value == null) {
    return (
      <LeaderboardCell value={display ?? accuracy} type="markdown" />
    );
  }

  return (
    <div className="flex min-w-72 items-center gap-3" title={`95% task-level confidence interval across ${nTasks ?? 'unknown'} tasks; not the spread of repeated runs.`}>
      <div className="w-44 shrink-0 whitespace-nowrap tabular-nums">
        <div className="font-semibold">{value.toFixed(1)}%</div>
        <div className="text-xs text-muted-foreground">95% CI {label}</div>
      </div>
      <div className="relative h-3 min-w-20 flex-1 overflow-hidden rounded-none bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-none"
          style={{
            backgroundColor: accentColor,
            width: `${Math.min(100, Math.max(0, value))}%`,
          }}
        />
        {interval ? (
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 border-x-2 border-current"
            style={{
              left: `${interval.lower}%`,
              width: `${interval.upper - interval.lower}%`,
            }}
          >
            <div className="absolute top-1/2 w-full border-t-2 border-current" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SortableHeader({
  column,
  label,
  align,
}: {
  column: Column<LeaderboardRow, unknown>;
  label: string;
  align?: LeaderboardColumn['align'];
}) {
  const sorted = column.getIsSorted();
  const icon =
    sorted === 'asc'
      ? ArrowUp01Icon
      : sorted === 'desc'
        ? ArrowDown01Icon
        : ArrowUpDownIcon;

  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 font-medium uppercase hover:text-foreground',
        align === 'right' && 'ml-auto',
        align === 'center' && 'mx-auto',
      )}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      <span>{label}</span>
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        className={cn(
          'size-3.5',
          sorted ? 'text-[#038f99]' : 'text-muted-foreground',
        )}
      />
    </button>
  );
}

const HIDDEN_TABLE_COLUMN_IDS = new Set(['reasoning_effort']);

function displayColumnHeader(column: LeaderboardColumn): string {
  const label = column.id === 'accuracy' ? 'Resolution Rate' : column.header;
  return label.toUpperCase();
}

/** Prefer Model before Agent until Hub column order is updated. */
function orderLeaderboardColumns(
  columns: LeaderboardColumn[],
): LeaderboardColumn[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  if (!byId.has('agent_display') || !byId.has('model_display')) {
    return columns;
  }

  const ordered: LeaderboardColumn[] = [];
  let emittedPair = false;
  for (const column of columns) {
    if (
      column.id === 'agent_display' ||
      column.id === 'model_display'
    ) {
      if (emittedPair) continue;
      emittedPair = true;
      const model = byId.get('model_display');
      const agent = byId.get('agent_display');
      if (model) ordered.push(model);
      if (agent) ordered.push(agent);
      continue;
    }
    ordered.push(column);
  }
  return ordered;
}

function escapeTsv(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ');
}

function exportColumnHeader(column: LeaderboardColumn): string {
  switch (column.id) {
    case 'accuracy':
      return 'Resolution Rate (%)';
    case 'total_cost_usd':
      return 'Cost (USD)';
    case 'total_tokens':
      return 'Tokens';
    default:
      return column.header;
  }
}

function formatExportDate(value: unknown): string {
  if (typeof value !== 'string') return String(value ?? '—');
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return date ? date[1] : value;
}

function formatExportCell(
  row: LeaderboardRow,
  column: LeaderboardColumn,
): string {
  const useRawValue = new Set([
    'accuracy',
    'total_cost_usd',
    'total_tokens',
    'release_date',
  ]).has(column.id);
  const accessor =
    useRawValue || !column.display_accessor
      ? column.accessor
      : column.display_accessor;
  const value = getAccessorValue(row, accessor);

  if (column.id === 'release_date') return formatExportDate(value);

  return formatLeaderboardCell(
    value,
    useRawValue && column.id !== 'release_date'
      ? 'number'
      : (column.display_type ?? column.type),
  );
}

type TsvColumn = {
  header: string;
  value: (row: LeaderboardRow) => string;
};

function tableRowsToTsv(
  rows: LeaderboardRow[],
  columns: LeaderboardColumn[],
  columnVisibility: VisibilityState,
  domain: DomainId,
): string {
  const exportColumns = orderLeaderboardColumns(columns).filter(
    (column) =>
      !HIDDEN_TABLE_COLUMN_IDS.has(column.id) &&
      columnVisibility[column.id] !== false,
  );
  const includeRank = columnVisibility.rank !== false;
  const tsvColumns: TsvColumn[] = [
    ...(includeRank
      ? [
          {
            header: 'Rank',
            value: (row: LeaderboardRow) => String(row.rank ?? '—'),
          },
        ]
      : []),
  ];

  for (const column of exportColumns) {
    tsvColumns.push({
      header: exportColumnHeader(column),
      value: (row) => escapeTsv(formatExportCell(row, column)),
    });
    if (column.id === 'accuracy') {
      tsvColumns.push({
        header: '95% CI lower (%)',
        value: (row) => confidenceBounds(row.metrics)?.lower.toFixed(2) ?? 'unavailable',
      });
      tsvColumns.push({
        header: '95% CI upper (%)',
        value: (row) => confidenceBounds(row.metrics)?.upper.toFixed(2) ?? 'unavailable',
      });
      tsvColumns.push({
        header: 'Tasks used for CI',
        value: (row) => String(row.metrics.accuracy_n_tasks ?? '—'),
      });
    }
    if (column.id === 'model_display') {
      tsvColumns.push({
        header: 'Reasoning Effort',
        value: (row) => {
          const effort = getAccessorValue(row, 'metadata.reasoning_effort');
          return escapeTsv(
            typeof effort === 'string' && effort.trim() ? effort.trim() : '—',
          );
        },
      });
    }
  }

  const header = tsvColumns.map((column) => column.header);
  const lines = rows.map((row) => {
    return tsvColumns.map((column) => column.value(row));
  });

  return [
    [domainExportTitle(domain, 'Leaderboard')],
    [],
    header,
    ...lines,
  ]
    .map((line) => line.join('\t'))
    .join('\n');
}

function CopyLeaderboardActions({
  rows,
  columns,
  columnVisibility,
  domain,
  accentColor,
}: {
  rows: LeaderboardRow[];
  columns: LeaderboardColumn[];
  columnVisibility: VisibilityState;
  domain: DomainId;
  accentColor: string;
}) {
  const [tableCopyState, setTableCopyState] = useState<
    'idle' | 'copied' | 'error'
  >('idle');
  const [imageCopyState, setImageCopyState] = useState<
    'idle' | 'copied' | 'error'
  >('idle');

  async function copyTable() {
    try {
      await navigator.clipboard.writeText(
        tableRowsToTsv(rows, columns, columnVisibility, domain),
      );
      setTableCopyState('copied');
    } catch {
      setTableCopyState('error');
    }
    window.setTimeout(() => setTableCopyState('idle'), 1600);
  }

  async function copyTableImage() {
    const table = document.getElementById(TABLE_IMAGE_ID);
    if (
      !table ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      setImageCopyState('error');
      window.setTimeout(() => setImageCopyState('idle'), 1600);
      return;
    }

    const { element: exportTable, remove } = createExportClone(table);
    try {
      const exportScrollArea = exportTable.querySelector<HTMLElement>(
        '[data-slot="scroll-area"]',
      );
      const exportViewport = exportTable.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      const exportDataTable = exportTable.querySelector<HTMLTableElement>(
        '[data-slot="table"]',
      );
      if (exportScrollArea && exportViewport && exportDataTable) {
        const fullTableWidth = Math.ceil(exportDataTable.scrollWidth);
        const exportWidth = Math.max(fullTableWidth, exportTable.offsetWidth);
        exportTable.style.width = `${exportWidth}px`;
        exportTable.style.maxWidth = 'none';
        exportTable.style.overflow = 'visible';
        exportScrollArea.style.width = `${exportWidth}px`;
        exportScrollArea.style.overflow = 'visible';
        exportViewport.scrollLeft = 0;
        exportViewport.style.width = `${exportWidth}px`;
        exportViewport.style.overflow = 'visible';
        exportDataTable.style.width = `${exportWidth}px`;
        for (const scrollbar of exportTable.querySelectorAll(
          '[data-slot="scroll-area-scrollbar"]',
        )) {
          scrollbar.remove();
        }
      }
      for (const row of exportTable.querySelectorAll<HTMLElement>(
        'tbody [data-slot="table-row"]',
      )) {
        row.removeAttribute('data-state');
        row.style.backgroundColor = 'transparent';
      }
      await waitForExportImages(exportTable);
      const backgroundColor =
        window.getComputedStyle(exportTable).backgroundColor;
      const image = await toBlob(exportTable, {
        backgroundColor,
        cacheBust: true,
        pixelRatio: highResolutionExportScale(exportTable),
      });
      if (!image) throw new Error('Could not create table image.');

      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': image }),
      ]);
      setImageCopyState('copied');
    } catch {
      setImageCopyState('error');
    } finally {
      remove();
    }

    window.setTimeout(() => setImageCopyState('idle'), 1600);
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy leaderboard as TSV"
              className="active:!translate-y-0"
              onClick={copyTable}
            >
              <HugeiconsIcon
                icon={
                  tableCopyState === 'copied' ? Tick02Icon : Copy01Icon
                }
                strokeWidth={2}
                className="text-muted-foreground"
                style={
                  tableCopyState === 'copied' ? { color: accentColor } : undefined
                }
              />
            </Button>
          }
        />
        <TooltipContent>
          {tableCopyState === 'copied'
            ? 'Copied as TSV'
            : tableCopyState === 'error'
              ? 'Could not copy TSV'
              : 'Copy leaderboard as TSV'}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy leaderboard as PNG"
              className="active:!translate-y-0"
              onClick={copyTableImage}
            >
              <HugeiconsIcon
                icon={
                  imageCopyState === 'copied' ? Tick02Icon : Image01Icon
                }
                strokeWidth={2}
                className="text-muted-foreground"
                style={
                  imageCopyState === 'copied' ? { color: accentColor } : undefined
                }
              />
            </Button>
          }
        />
        <TooltipContent>
          {imageCopyState === 'copied'
            ? 'Copied as PNG'
            : imageCopyState === 'error'
              ? 'Could not copy PNG'
              : 'Copy leaderboard as PNG'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function buildColumns(
  columns: LeaderboardColumn[],
  accentColor: string,
): ColumnDef<LeaderboardRow>[] {
  const rankColumn: ColumnDef<LeaderboardRow> = {
    id: 'rank',
    header: 'RANK',
    accessorFn: (row) => row.rank,
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {row.original.rank ?? '—'}
      </span>
    ),
    enableSorting: false,
    meta: {
      headerClassName: 'w-12 text-center',
      cellClassName: 'text-center',
    },
  };

  const dataColumns = orderLeaderboardColumns(columns)
    .filter((column) => !HIDDEN_TABLE_COLUMN_IDS.has(column.id))
    .map((column): ColumnDef<LeaderboardRow> => {
      const displayType = column.display_type ?? column.type;
      const columnAlign =
        column.id === 'accuracy' ? 'left' : column.align;
      const align = alignClass(columnAlign);
      const sortable = SORTABLE_COLUMN_IDS.has(column.id);
      const headerLabel = displayColumnHeader(column);
      return {
        id: column.id,
        accessorFn: (row) => getAccessorValue(row, column.accessor),
        header: sortable
          ? ({ column: tableColumn }) => (
              <SortableHeader
                column={tableColumn}
                label={headerLabel}
                align={columnAlign}
              />
            )
          : headerLabel,
        cell: ({ row }) => {
          const value = column.display_accessor
            ? getAccessorValue(row.original, column.display_accessor)
            : getAccessorValue(row.original, column.accessor);

          if (column.id === 'model_display') {
            const effort = getAccessorValue(
              row.original,
              'metadata.reasoning_effort',
            );
            const effortLabel =
              typeof effort === 'string' && effort.trim()
                ? effort.trim()
                : null;
            return (
              <span className="inline-flex items-baseline gap-1">
                <LeaderboardCell value={value} type={displayType} />
                {effortLabel ? (
                  <span className="text-xs text-muted-foreground">
                    ({effortLabel})
                  </span>
                ) : null}
              </span>
            );
          }

          if (column.id === 'accuracy') {
            return (
              <AccuracyBarCell
                row={row.original}
                accentColor={accentColor}
              />
            );
          }

          return <LeaderboardCell value={value} type={displayType} />;
        },
        enableSorting: sortable,
        meta: {
          headerClassName: align,
          cellClassName: cn(
            align,
            column.type === 'number' && 'tabular-nums',
            column.id === 'accuracy' && 'min-w-56',
          ),
        },
      };
    });

  return [rankColumn, ...dataColumns];
}

export function LeaderboardTable({ domain }: { domain: DomainId }) {
  const domainDefinition = getDomain(domain);
  const { data, error, isPending } = useQuery({
    queryKey: leaderboardQueryKey(
      TERMINAL_BENCH_PACKAGE,
      TERMINAL_BENCH_LEADERBOARD,
    ),
    queryFn: () =>
      fetchLeaderboard(TERMINAL_BENCH_PACKAGE, TERMINAL_BENCH_LEADERBOARD),
  });

  const domainRows = useMemo(
    () => (data ? projectLeaderboardRowsToDomain(data.rows, domain) : []),
    [data, domain],
  );

  const facets = useMemo(() => {
    if (!data) {
      return {
        numberBounds: {},
        dateBounds: {},
        setOptions: {},
      };
    }
    return buildFilterFacets(data.leaderboard.columns, domainRows);
  }, [data, domainRows]);

  const [urlFilters, setUrlFilters] = useQueryState(
    'filters',
    leaderboardFiltersParser,
  );
  const [hiddenColumns, setHiddenColumns] = useQueryState(
    'hide',
    hiddenColumnsParser,
  );

  const filters = useMemo(
    () => fromUrlFilters(urlFilters, facets.numberBounds),
    [facets.numberBounds, urlFilters],
  );

  const columnVisibility = useMemo(() => {
    const visibility: VisibilityState = {};
    for (const id of hiddenColumns) {
      visibility[id] = false;
    }
    return visibility;
  }, [hiddenColumns]);

  function handleFiltersChange(next: LeaderboardFilters) {
    void setUrlFilters(toUrlFilters(next, facets.numberBounds));
  }

  const handleColumnVisibilityChange: OnChangeFn<VisibilityState> = (
    updater,
  ) => {
    const next =
      typeof updater === 'function' ? updater(columnVisibility) : updater;
    const hidden = Object.entries(next)
      .filter(([, visible]) => visible === false)
      .map(([id]) => id);
    // Persist [] when everything is visible so defaults don't snap back on.
    void setHiddenColumns(hidden);
  };

  const filteredRows = useMemo(() => {
    if (!data) return [];
    return applyLeaderboardFilters(
      domainRows,
      data.leaderboard.columns,
      filters,
      facets.numberBounds,
    );
  }, [data, domainRows, facets.numberBounds, filters]);

  const tableColumns = useMemo(
    () =>
      data
        ? buildColumns(data.leaderboard.columns, domainDefinition.color)
        : [],
    [data, domainDefinition.color],
  );

  const columnOptions = useMemo(() => {
    if (!data) return [];
    return [
      { id: 'rank', label: 'RANK', canHide: true },
      ...orderLeaderboardColumns(data.leaderboard.columns)
        .filter((column) => !HIDDEN_TABLE_COLUMN_IDS.has(column.id))
        .map((column) => ({
          id: column.id,
          label: displayColumnHeader(column),
          canHide: true,
        })),
    ];
  }, [data]);

  const toolbarColumns = useMemo(() => {
    if (!data) return [];
    return data.leaderboard.columns.map((column) => ({
      ...column,
      header: displayColumnHeader(column),
    }));
  }, [data]);

  if (isPending) {
    return <LeaderboardSkeleton />;
  }

  if (error || !data) {
    return (
      <div className="-mx-4 rounded-none border border-x-0 border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm text-destructive md:mx-0 md:rounded-xl md:border-x">
        {error?.message ?? 'Failed to load leaderboard'}
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 text-left">
      <DataTable
        columns={tableColumns}
        data={filteredRows}
        emptyMessage="No leaderboard rows match the current filters."
        panelHeader={
          <ViewHeader
            title={
              <>
                Terminal-Bench-Science 0.1 Leaderboard
                {domain !== 'all' ? (
                  <>
                    {' · '}
                    <span
                      data-export-domain-accent={domainDefinition.color}
                    >
                      {domainDefinition.title}
                    </span>
                  </>
                ) : null}
              </>
            }
          />
        }
        headerClassName="border-b"
        tableContainerId={TABLE_IMAGE_ID}
        getRowId={(row) => row.id}
        getRowHref={(row) =>
          harborLeaderboardRowUrl(
            TERMINAL_BENCH_PACKAGE,
            TERMINAL_BENCH_LEADERBOARD,
            row.id,
          )
        }
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={handleColumnVisibilityChange}
        toolbar={
          <div className="flex w-full min-w-0 items-center gap-1.5">
            <CopyLeaderboardActions
              rows={filteredRows}
              columns={data.leaderboard.columns}
              columnVisibility={columnVisibility}
              domain={domain}
              accentColor={domainDefinition.color}
            />
            <LeaderboardToolbar
              columns={toolbarColumns}
              columnOptions={columnOptions}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              numberBounds={facets.numberBounds}
              dateBounds={facets.dateBounds}
              setOptions={facets.setOptions}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={handleColumnVisibilityChange}
              accentColor={domainDefinition.color}
            />
          </div>
        }
        footer={
          <ViewDescriptionBar>
            95% confidence intervals use task averages and describe uncertainty
            across comparable tasks.{' '}
            <Link href="/docs/evaluation-statistics" className="underline">Methodology</Link>
          </ViewDescriptionBar>
        }
      />
    </div>
  );
}
