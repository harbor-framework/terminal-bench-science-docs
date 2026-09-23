'use client';

import Link from 'next/link';

import {
  Copy01Icon,
  Image01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { toBlob } from 'html-to-image';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useMemo, useState } from 'react';

import {
  DEFAULT_PARETO_X,
  DEFAULT_PARETO_Y,
  PARETO_AXES,
  PARETO_X_AXIS_IDS,
  isParetoXAxisId,
} from '@/components/charts/pareto-axes';
import {
  ParetoScatterChart,
  buildParetoData,
  type ParetoDatum,
} from '@/components/charts/pareto-scatter-chart';
import {
  applyLeaderboardFilters,
  buildFilterFacets,
  LeaderboardToolbar,
  type LeaderboardFilters,
} from '@/components/leaderboard/leaderboard-toolbar';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ViewDescriptionBar } from '@/components/view-description-bar';
import { ViewHeader } from '@/components/view-header';
import {
  TERMINAL_BENCH_LEADERBOARD,
  TERMINAL_BENCH_PACKAGE,
  fetchLeaderboard,
  formatLeaderboardCell,
  leaderboardQueryKey,
  projectLeaderboardRowsToDomain,
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
  leaderboardFiltersParser,
  toUrlFilters,
} from '@/lib/leaderboard-url-state';

const parseParetoXAxis = parseAsStringLiteral(PARETO_X_AXIS_IDS);
const PARETO_IMAGE_ID = 'pareto-chart-image';
const SVG_CAPTURE_PROPERTIES = [
  'color',
  'fill',
  'font-family',
  'font-size',
  'font-weight',
  'opacity',
  'stroke',
  'stroke-width',
] as const;

function resolveCaptureColor(value: string, context: CanvasRenderingContext2D): string {
  if (!value || value === 'none' || value === 'currentcolor') return value;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = 'rgb(1, 2, 3)';
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
  if (red === 1 && green === 2 && blue === 3 && alpha === 255) return value;
  return `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`;
}

function inlineParetoSvgStyles(
  chart: HTMLElement,
): { backgroundColor?: string; restore: () => void } {
  const svg = chart.querySelector<SVGSVGElement>('svg[role="img"]');
  if (!svg) return { restore: () => {} };

  const context = document.createElement('canvas').getContext('2d');
  const cardBackground = window.getComputedStyle(chart).backgroundColor;

  const elements = [svg, ...svg.querySelectorAll<SVGElement>('*')];
  const originalStyles = elements.map((element) => ({
    element,
    style: element.getAttribute('style'),
  }));

  for (const element of elements) {
    const styles = window.getComputedStyle(element);
    for (const property of SVG_CAPTURE_PROPERTIES) {
      const value = styles.getPropertyValue(property);
      element.style.setProperty(
        property,
        context && ['color', 'fill', 'stroke'].includes(property)
          ? resolveCaptureColor(value, context)
          : value,
      );
    }
  }

  const isDark = document.documentElement.classList.contains('dark');
  const foreground = isDark ? '#fafafa' : '#0a0a0a';
  const mutedForeground = isDark ? '#a1a1aa' : '#71717a';
  const gridColor = isDark
    ? 'rgba(255, 255, 255, 0.2)'
    : 'rgba(0, 0, 0, 0.2)';
  const axisColor = isDark
    ? 'rgba(161, 161, 170, 0.65)'
    : 'rgba(82, 82, 91, 0.65)';
  const mutedPoint = isDark
    ? 'rgba(161, 161, 170, 0.35)'
    : 'rgba(82, 82, 91, 0.35)';

  for (const element of svg.querySelectorAll<SVGElement>('*')) {
    const className = element.getAttribute('class') ?? '';
    if (className.includes('stroke-border')) {
      element.style.stroke = gridColor;
      element.style.strokeWidth = '1';
    }
    if (className.includes('stroke-muted-foreground')) {
      element.style.stroke = axisColor;
      element.style.strokeWidth = '1.25';
    }
    if (className.includes('fill-foreground')) {
      element.style.fill = foreground;
    }
    if (className.includes('fill-muted-foreground/35')) {
      element.style.fill = mutedPoint;
    } else if (className.includes('fill-muted-foreground')) {
      element.style.fill = mutedForeground;
    }
  }

  return {
    backgroundColor: context
      ? resolveCaptureColor(cardBackground ?? '', context)
      : cardBackground,
    restore: () => {
      for (const { element, style } of originalStyles) {
        if (style == null) {
          element.removeAttribute('style');
        } else {
          element.setAttribute('style', style);
        }
      }
    },
  };
}

function paretoAxisHeader(axisId: keyof typeof PARETO_AXES): string {
  switch (axisId) {
    case 'accuracy':
      return 'Resolution Rate (%)';
    case 'cost':
      return 'Cost (USD)';
    case 'tokens':
      return 'Tokens';
    case 'release_date':
      return 'Release Date';
  }
}

function paretoValueForExport(
  value: number,
  axisId: keyof typeof PARETO_AXES,
): string {
  if (axisId === 'release_date') {
    return new Date(value).toISOString().slice(0, 10);
  }
  return formatLeaderboardCell(value, 'number');
}

function paretoDataToTsv(
  data: ParetoDatum[],
  xAxisId: keyof typeof PARETO_AXES,
  yAxisId: keyof typeof PARETO_AXES,
  domain: DomainId,
): string {
  const hasAccuracy = xAxisId === 'accuracy' || yAxisId === 'accuracy';
  const header = [
    'Model',
    'Agent',
    paretoAxisHeader(yAxisId),
    paretoAxisHeader(xAxisId),
    ...(hasAccuracy ? ['95% CI lower (%)', '95% CI upper (%)'] : []),
    'Pareto Frontier',
  ];
  const rows = data.map((point) => [
    point.label.model,
    point.label.agent,
    paretoValueForExport(point.y, yAxisId),
    paretoValueForExport(point.x, xAxisId),
    ...(hasAccuracy ? [
      point.accuracyInterval?.lower.toFixed(2) ?? 'unavailable',
      point.accuracyInterval?.upper.toFixed(2) ?? 'unavailable',
    ] : []),
    point.onFrontier ? 'Yes' : 'No',
  ]);
  const curveTitle = `${PARETO_AXES[yAxisId].label} vs. ${PARETO_AXES[xAxisId].label}`;

  return [
    [`${domainExportTitle(domain, 'Pareto Data')} (${curveTitle})`],
    [],
    header,
    ...rows,
  ]
    .map((line) => line.join('\t'))
    .join('\n');
}

function CopyParetoActions({
  data,
  xAxisId,
  yAxisId,
  domain,
  accentColor,
}: {
  data: ParetoDatum[];
  xAxisId: keyof typeof PARETO_AXES;
  yAxisId: keyof typeof PARETO_AXES;
  domain: DomainId;
  accentColor: string;
}) {
  const [tableCopyState, setTableCopyState] = useState<
    'idle' | 'copied' | 'error'
  >('idle');
  const [imageCopyState, setImageCopyState] = useState<
    'idle' | 'copied' | 'error'
  >('idle');

  async function copyData() {
    try {
      await navigator.clipboard.writeText(
        paretoDataToTsv(data, xAxisId, yAxisId, domain),
      );
      setTableCopyState('copied');
    } catch {
      setTableCopyState('error');
    }
    window.setTimeout(() => setTableCopyState('idle'), 1600);
  }

  async function copyChartImage() {
    const chart = document.getElementById(PARETO_IMAGE_ID);
    if (
      !chart ||
      !navigator.clipboard?.write ||
      typeof ClipboardItem === 'undefined'
    ) {
      setImageCopyState('error');
      window.setTimeout(() => setImageCopyState('idle'), 1600);
      return;
    }

    const { element: exportChart, remove } = createExportClone(chart);
    const { backgroundColor, restore: restoreSvgStyles } =
      inlineParetoSvgStyles(exportChart);
    try {
      await waitForExportImages(exportChart);
      const image = await toBlob(exportChart, {
        backgroundColor,
        cacheBust: true,
        pixelRatio: highResolutionExportScale(exportChart),
        filter: (node) =>
          !(node instanceof Element && node.hasAttribute('data-export-ignore')),
      });
      if (!image) throw new Error('Could not create Pareto chart image.');
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': image }),
      ]);
      setImageCopyState('copied');
    } catch {
      setImageCopyState('error');
    } finally {
      restoreSvgStyles();
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
              aria-label="Copy Pareto data as TSV"
              className="active:!translate-y-0"
              onClick={copyData}
            >
              <HugeiconsIcon
                icon={tableCopyState === 'copied' ? Tick02Icon : Copy01Icon}
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
              : 'Copy Pareto data as TSV'}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy Pareto chart as PNG"
              className="active:!translate-y-0"
              onClick={copyChartImage}
            >
              <HugeiconsIcon
                icon={imageCopyState === 'copied' ? Tick02Icon : Image01Icon}
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
              : 'Copy Pareto chart as PNG'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function ParetoView({ domain }: { domain: DomainId }) {
  const domainDefinition = getDomain(domain);
  const [xAxisId, setXAxisId] = useQueryState(
    'x',
    parseParetoXAxis.withDefault(DEFAULT_PARETO_X),
  );

  const yAxisId = DEFAULT_PARETO_Y;

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
  const filters = useMemo(
    () => fromUrlFilters(urlFilters, facets.numberBounds),
    [facets.numberBounds, urlFilters],
  );
  const filteredRows = useMemo(() => {
    if (!data) return [];
    return applyLeaderboardFilters(
      domainRows,
      data.leaderboard.columns,
      filters,
      facets.numberBounds,
    );
  }, [data, domainRows, facets.numberBounds, filters]);
  function handleFiltersChange(next: LeaderboardFilters) {
    void setUrlFilters(toUrlFilters(next, facets.numberBounds));
  }

  const chartData = useMemo(
    () => buildParetoData(filteredRows, xAxisId, yAxisId),
    [filteredRows, xAxisId, yAxisId],
  );

  const xLabel = PARETO_AXES[xAxisId].label;
  const yLabel = PARETO_AXES[yAxisId].label;
  const xMetricDescription =
    xAxisId === 'cost'
      ? 'total cost'
      : xAxisId === 'tokens'
        ? 'total token usage'
        : 'model release date';

  if (isPending) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-end">
          <LeaderboardToolbar
            columns={[]}
            columnOptions={[]}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            numberBounds={facets.numberBounds}
            dateBounds={facets.dateBounds}
            setOptions={facets.setOptions}
            columnVisibility={{}}
            onColumnVisibilityChange={() => {}}
            accentColor={domainDefinition.color}
            showColumnControls={false}
          />
        </div>
        <div className="-mx-4 rounded-none border border-x-0 px-4 py-10 text-center text-sm text-muted-foreground md:mx-0 md:rounded-xl md:border-x">
          Loading Pareto…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-end">
          <LeaderboardToolbar
            columns={[]}
            columnOptions={[]}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            numberBounds={facets.numberBounds}
            dateBounds={facets.dateBounds}
            setOptions={facets.setOptions}
            columnVisibility={{}}
            onColumnVisibilityChange={() => {}}
            accentColor={domainDefinition.color}
            showColumnControls={false}
          />
        </div>
        <div className="-mx-4 rounded-none border border-x-0 border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm text-destructive md:mx-0 md:rounded-xl md:border-x">
          {error?.message ?? 'Failed to load Pareto data'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <CopyParetoActions
          data={chartData}
          xAxisId={xAxisId}
          yAxisId={yAxisId}
          domain={domain}
          accentColor={domainDefinition.color}
        />
        <LeaderboardToolbar
          columns={data.leaderboard.columns}
          columnOptions={[]}
          filters={filters}
          onFiltersChange={handleFiltersChange}
          numberBounds={facets.numberBounds}
          dateBounds={facets.dateBounds}
          setOptions={facets.setOptions}
          columnVisibility={{}}
          onColumnVisibilityChange={() => {}}
          accentColor={domainDefinition.color}
          showColumnControls={false}
        />
      </div>
      <div
        id={PARETO_IMAGE_ID}
        className="-mx-4 min-w-0 overflow-hidden rounded-none border border-x-0 bg-card md:mx-0 md:rounded-xl md:border-x"
      >
        <ViewHeader
          title={
            <>
              Terminal-Bench-Science 0.1 Pareto Frontier
              {domain !== 'all' ? (
                <>
                  {' · '}
                  <span data-export-domain-accent={domainDefinition.color}>
                    {domainDefinition.title}
                  </span>
                </>
              ) : null}
            </>
          }
          subtitle={`${yLabel} vs. ${xLabel}`}
        >
          <div className="flex items-center gap-2 uppercase">
            <span className="text-xs text-muted-foreground">{yLabel} vs</span>
            <Select
              value={xAxisId}
              onValueChange={(next) => {
                if (typeof next === 'string' && isParetoXAxisId(next)) {
                  void setXAxisId(next);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="min-w-36 bg-background text-xs uppercase dark:bg-card"
              >
                <SelectValue>{xLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent
                side="bottom"
                align="start"
                alignItemWithTrigger={false}
                collisionAvoidance={{ side: 'none' }}
              >
                {PARETO_X_AXIS_IDS.map((axisId) => (
                  <SelectItem
                    key={axisId}
                    value={axisId}
                    className="text-xs uppercase"
                  >
                    {PARETO_AXES[axisId].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </ViewHeader>
        <ParetoScatterChart
          data={chartData}
          xAxisId={xAxisId}
          yAxisId={yAxisId}
          domain={domain}
          accentColor={domainDefinition.color}
          className="px-2 py-3"
        />
        <ViewDescriptionBar>
          Resolution rate vs. {xMetricDescription}. Whiskers show 95% task-level
          confidence intervals.{' '}
          <Link href="/docs/evaluation-statistics" className="underline">Methodology</Link>
        </ViewDescriptionBar>
      </div>
    </div>
  );
}
