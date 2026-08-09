'use client';

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
import { HomeViewToggle } from '@/components/home-view-toggle';
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
import {
  TERMINAL_BENCH_LEADERBOARD,
  TERMINAL_BENCH_PACKAGE,
  fetchLeaderboard,
  formatLeaderboardCell,
  leaderboardQueryKey,
} from '@/lib/leaderboard';

const parseParetoXAxis = parseAsStringLiteral(PARETO_X_AXIS_IDS);
const PARETO_IMAGE_ID = 'pareto-chart-image';
const Z_95 = 1.96;
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
  const fallback = '#010203';
  context.fillStyle = fallback;
  context.fillStyle = value;
  return context.fillStyle === fallback && value !== fallback
    ? value
    : context.fillStyle;
}

function inlineParetoSvgStyles(
  chart: HTMLElement,
): { backgroundColor?: string; restore: () => void } {
  const svg = chart.querySelector('svg');
  if (!svg) return { restore: () => {} };

  const context = document.createElement('canvas').getContext('2d');
  const cardBackground = chart.parentElement
    ? window.getComputedStyle(chart.parentElement).backgroundColor
    : undefined;

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

function formatConfidenceInterval(point: ParetoDatum): string {
  if (point.accuracyStderr == null) return '—';
  return (Z_95 * point.accuracyStderr).toFixed(2);
}

function paretoDataToTsv(
  data: ParetoDatum[],
  xAxisId: keyof typeof PARETO_AXES,
  yAxisId: keyof typeof PARETO_AXES,
): string {
  const header = [
    'Model',
    'Agent',
    paretoAxisHeader(yAxisId),
    ...(yAxisId === 'accuracy' ? ['95% CI (± pp)'] : []),
    paretoAxisHeader(xAxisId),
    'Pareto Frontier',
  ];
  const rows = data.map((point) => [
    point.label.model,
    point.label.agent,
    paretoValueForExport(point.y, yAxisId),
    ...(yAxisId === 'accuracy' ? [formatConfidenceInterval(point)] : []),
    paretoValueForExport(point.x, xAxisId),
    point.onFrontier ? 'Yes' : 'No',
  ]);
  const curveTitle = `${PARETO_AXES[yAxisId].label} vs. ${PARETO_AXES[xAxisId].label}`;

  return [
    [`Terminal-Bench Science 0.1 Pareto Data (${curveTitle})`],
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
}: {
  data: ParetoDatum[];
  xAxisId: keyof typeof PARETO_AXES;
  yAxisId: keyof typeof PARETO_AXES;
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
        paretoDataToTsv(data, xAxisId, yAxisId),
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

    const { backgroundColor, restore: restoreSvgStyles } =
      inlineParetoSvgStyles(chart);
    try {
      const image = await toBlob(chart, {
        backgroundColor,
        cacheBust: true,
        pixelRatio: 1,
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
              onClick={copyData}
            >
              <HugeiconsIcon
                icon={tableCopyState === 'copied' ? Tick02Icon : Copy01Icon}
                strokeWidth={2}
                className="text-muted-foreground"
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
              onClick={copyChartImage}
            >
              <HugeiconsIcon
                icon={imageCopyState === 'copied' ? Tick02Icon : Image01Icon}
                strokeWidth={2}
                className="text-muted-foreground"
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

export function ParetoView() {
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

  const chartData = useMemo(
    () => (data ? buildParetoData(data.rows, xAxisId, yAxisId) : []),
    [data, xAxisId, yAxisId],
  );

  const xLabel = PARETO_AXES[xAxisId].label;
  const yLabel = PARETO_AXES[yAxisId].label;

  if (isPending) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-end">
          <HomeViewToggle />
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
          <HomeViewToggle />
        </div>
        <div className="-mx-4 rounded-none border border-x-0 border-destructive/30 bg-destructive/5 px-4 py-10 text-center text-sm text-destructive md:mx-0 md:rounded-xl md:border-x">
          {error?.message ?? 'Failed to load Pareto data'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <CopyParetoActions
          data={chartData}
          xAxisId={xAxisId}
          yAxisId={yAxisId}
        />
        <HomeViewToggle />
      </div>
      <div className="-mx-4 min-w-0 overflow-hidden rounded-none border border-x-0 bg-card md:mx-0 md:rounded-xl md:border-x">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 uppercase">
          <span className="text-sm text-muted-foreground">{yLabel} vs</span>
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
              className="min-w-36 bg-background uppercase dark:bg-card"
            >
              <SelectValue>{xLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {PARETO_X_AXIS_IDS.map((axisId) => (
                <SelectItem key={axisId} value={axisId} className="uppercase">
                  {PARETO_AXES[axisId].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ParetoScatterChart
          data={chartData}
          xAxisId={xAxisId}
          yAxisId={yAxisId}
          id={PARETO_IMAGE_ID}
          className="px-2 py-3"
        />
      </div>
    </div>
  );
}
