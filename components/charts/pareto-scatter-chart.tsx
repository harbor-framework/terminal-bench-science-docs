'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { chartRowLabel, type ChartRowLabel } from '@/components/charts/chart-labels';
import {
  PARETO_AXES,
  type ParetoAxisDef,
  type ParetoAxisId,
} from '@/components/charts/pareto-axes';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { getDomain, type DomainId } from '@/lib/domain-context';
import { getAccessorValue, type LeaderboardRow } from '@/lib/leaderboard';
import { confidenceBounds, confidenceLabel, type ConfidenceBounds } from '@/lib/task-confidence';
import { cn } from '@/lib/utils';

export type ParetoDatum = {
  id: string;
  label: ChartRowLabel;
  reasoningEffort: string | null;
  cost: number | null;
  tokens: number | null;
  releaseDate: number | null;
  x: number;
  y: number;
  accuracyInterval: ConfidenceBounds | null;
  accuracyIntervalLabel: string;
  onFrontier: boolean;
};

const MIN_WIDTH = 480;
const HEIGHT = 580;
const MARGIN = { top: 20, right: 28, bottom: 52, left: 84 };
/** Half-side length of plot markers (squares). */
const DOT_HALF = 4;
const FRONTIER_DOT_HALF = 5;

function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min) || count < 2) return [min, max];
  const span = max - min;
  const step = span / (count - 1);
  const raw = 10 ** Math.floor(Math.log10(step));
  const err = step / raw;
  const niceStep =
    err >= 7.5 ? 10 * raw : err >= 3.5 ? 5 * raw : err >= 1.5 ? 2 * raw : raw;
  const niceMin = Math.floor(min / niceStep) * niceStep;
  const niceMax = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + niceStep * 0.5; v += niceStep) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

function dateTicks(min: number, max: number, count: number): number[] {
  if (!(max > min) || count < 2) return [min, max];
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(min + ((max - min) * i) / (count - 1));
  }
  return ticks;
}

function axisTicks(
  axisId: ParetoAxisId,
  values: number[],
  padRatio: number,
): number[] {
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const pad = (maxV - minV) * padRatio || Math.abs(maxV) * 0.05 || 1;

  if (axisId === 'release_date') {
    const day = 24 * 60 * 60 * 1000;
    return dateTicks(minV - day * 2, maxV + day * 2, 5);
  }

  let lo = minV - pad;
  let hi = maxV + pad;
  if (axisId === 'accuracy') {
    lo = Math.max(0, lo);
    hi = Math.min(100, hi);
  } else if (axisId === 'cost' || axisId === 'tokens') {
    lo = Math.max(0, lo);
  }

  return niceTicks(lo, hi, 5);
}

function isBetterOrEqual(
  a: number,
  b: number,
  prefer: ParetoAxisDef['prefer'],
): boolean {
  return prefer === 'max' ? a >= b : a <= b;
}

function isStrictlyBetter(
  a: number,
  b: number,
  prefer: ParetoAxisDef['prefer'],
): boolean {
  return prefer === 'max' ? a > b : a < b;
}

export function computeParetoFrontier(
  points: Omit<ParetoDatum, 'onFrontier'>[],
  xAxis: ParetoAxisDef,
  yAxis: ParetoAxisDef,
): Set<string> {
  const frontier = new Set<string>();
  for (const point of points) {
    const dominated = points.some(
      (other) =>
        other.id !== point.id &&
        isBetterOrEqual(other.x, point.x, xAxis.prefer) &&
        isBetterOrEqual(other.y, point.y, yAxis.prefer) &&
        (isStrictlyBetter(other.x, point.x, xAxis.prefer) ||
          isStrictlyBetter(other.y, point.y, yAxis.prefer)),
    );
    if (!dominated) frontier.add(point.id);
  }
  return frontier;
}

export function buildParetoData(
  rows: LeaderboardRow[],
  xAxisId: ParetoAxisId,
  yAxisId: ParetoAxisId,
): ParetoDatum[] {
  const xAxis = PARETO_AXES[xAxisId];
  const yAxis = PARETO_AXES[yAxisId];

  const points = rows
    .map((row) => {
      const x = xAxis.read(row);
      const y = yAxis.read(row);
      if (x == null || y == null) return null;
      const reasoningEffort = getAccessorValue(
        row,
        'metadata.reasoning_effort',
      );
      const cost = PARETO_AXES.cost.read(row);
      const tokens = PARETO_AXES.tokens.read(row);
      const releaseDate = PARETO_AXES.release_date.read(row);
      return {
        id: row.id,
        label: chartRowLabel(row),
        reasoningEffort:
          typeof reasoningEffort === 'string' && reasoningEffort.trim()
            ? reasoningEffort.trim()
            : null,
        cost,
        tokens,
        releaseDate,
        x,
        y,
        accuracyInterval: confidenceBounds(row.metrics),
        accuracyIntervalLabel: `95% resolution CI ${confidenceLabel(row.metrics)}`,
      };
    })
    .filter((row): row is Omit<ParetoDatum, 'onFrontier'> => row != null);

  const frontier = computeParetoFrontier(points, xAxis, yAxis);
  return points
    .map((point) => ({
      ...point,
      onFrontier: frontier.has(point.id),
    }))
    .sort((a, b) => a.x - b.x);
}

type ParetoScatterChartProps = {
  data: ParetoDatum[];
  xAxisId: ParetoAxisId;
  yAxisId: ParetoAxisId;
  domain: DomainId;
  accentColor: string;
  className?: string;
  id?: string;
};

type ActiveTip = {
  id: string;
  model: string;
  agent: string;
  reasoningEffort: string | null;
  cost: string;
  tokens: string;
  releaseDate: string;
  accuracyIntervalLabel: string;
  cx: number;
  cy: number;
  onFrontier: boolean;
};

export function ParetoScatterChart({
  data,
  xAxisId,
  yAxisId,
  domain,
  accentColor,
  className,
  id,
}: ParetoScatterChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(MIN_WIDTH);
  const [active, setActive] = useState<ActiveTip | null>(null);
  const [tipOpen, setTipOpen] = useState(false);
  const xAxis = PARETO_AXES[xAxisId];
  const yAxis = PARETO_AXES[yAxisId];
  const domainDefinition = getDomain(domain);

  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return;

    const update = () => {
      const nextWidth = Math.max(
        MIN_WIDTH,
        Math.floor(el.getBoundingClientRect().width),
      );
      setWidth((current) => (current === nextWidth ? current : nextWidth));
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    const frame = window.requestAnimationFrame(update);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
    };
  }, [data.length]);

  // Clear tip when axes or domain scope change so we don't show stale content.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setTipOpen(false);
      setActive(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [domain, xAxisId, yAxisId]);

  if (data.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted-foreground">
        No Pareto data to chart.
      </p>
    );
  }

  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(0, HEIGHT - MARGIN.top - MARGIN.bottom);

  const xs = data.flatMap((d) => xAxisId === 'accuracy' && d.accuracyInterval
    ? [d.x, d.accuracyInterval.lower, d.accuracyInterval.upper] : [d.x]);
  const ys = data.flatMap((d) => yAxisId === 'accuracy' && d.accuracyInterval
    ? [d.y, d.accuracyInterval.lower, d.accuracyInterval.upper] : [d.y]);
  const xTicks = axisTicks(xAxisId, xs, 0.08);
  const yTicks = axisTicks(yAxisId, ys, 0.12);
  const xMin = xTicks[0]!;
  const xMax = xTicks[xTicks.length - 1]!;
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;

  const xScale = (value: number) =>
    MARGIN.left + ((value - xMin) / (xMax - xMin || 1)) * plotW;
  const yScale = (value: number) =>
    MARGIN.top + (1 - (value - yMin) / (yMax - yMin || 1)) * plotH;

  const frontier = data.filter((d) => d.onFrontier).sort((a, b) => a.x - b.x);
  const frontierPath = frontier
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(d.x)} ${yScale(d.y)}`)
    .join(' ');

  return (
    <div id={id} className={cn('w-full min-w-0', className)}>
      <div ref={plotRef} className="relative w-full overflow-hidden" style={{ height: HEIGHT }}>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`Pareto scatter of ${yAxis.label} versus ${xAxis.label} for ${domainDefinition.title}`}
        className="block max-w-full"
      >
        {xTicks.slice(1, -1).map((tick) => (
          <line
            key={`x-grid-${tick}`}
            x1={xScale(tick)}
            y1={MARGIN.top}
            x2={xScale(tick)}
            y2={MARGIN.top + plotH}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}
        {yTicks.slice(1, -1).map((tick) => (
          <line
            key={`y-grid-${tick}`}
            x1={MARGIN.left}
            y1={yScale(tick)}
            x2={MARGIN.left + plotW}
            y2={yScale(tick)}
            className="stroke-border"
            strokeWidth={1}
          />
        ))}

        <line
          x1={MARGIN.left}
          y1={MARGIN.top + plotH}
          x2={MARGIN.left + plotW}
          y2={MARGIN.top + plotH}
          className="stroke-muted-foreground/40"
          strokeWidth={1}
        />
        <line
          x1={MARGIN.left}
          y1={MARGIN.top}
          x2={MARGIN.left}
          y2={MARGIN.top + plotH}
          className="stroke-muted-foreground/40"
          strokeWidth={1}
        />

        {xTicks.map((tick) => (
          <text
            key={`x-label-${tick}`}
            x={xScale(tick)}
            y={MARGIN.top + plotH + 20}
            textAnchor="middle"
            className="fill-muted-foreground font-normal"
            fontSize={12}
          >
            {xAxis.format(tick)}
          </text>
        ))}
        {yTicks.map((tick) => (
          <text
            key={`y-label-${tick}`}
            x={MARGIN.left - 12}
            y={yScale(tick)}
            textAnchor="end"
            dominantBaseline="central"
            className="fill-muted-foreground font-normal"
            fontSize={12}
          >
            {yAxis.format(tick)}
          </text>
        ))}

        <text
          x={MARGIN.left + plotW / 2}
          y={HEIGHT - 12}
          textAnchor="middle"
          className="fill-muted-foreground font-normal"
          fontSize={12}
        >
          {xAxis.label}
        </text>
        <g transform={`translate(16 ${MARGIN.top + plotH / 2}) rotate(-90)`}>
          <text
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-muted-foreground font-normal"
            fontSize={12}
          >
            {yAxis.label}
          </text>
        </g>

        {frontierPath ? (
          <path
            d={frontierPath}
            fill="none"
            stroke={accentColor}
            strokeWidth={2}
          />
        ) : null}

        {data.map((datum) => {
          const cx = xScale(datum.x);
          const cy = yScale(datum.y);
          const half = datum.onFrontier ? FRONTIER_DOT_HALF : DOT_HALF;
          const size = half * 2;
          const modelText = datum.label.model;
          const agentText = datum.label.agent;
          const labelOnLeft = cx > MARGIN.left + plotW * 0.75;
          const labelX = labelOnLeft ? cx - half - 6 : cx + half + 6;
          return (
            <g key={datum.id}>
              {datum.accuracyInterval ? (
                <g stroke={accentColor} strokeOpacity={0.55} strokeWidth={1.5} style={{ pointerEvents: 'none' }}>
                  <title>{datum.accuracyIntervalLabel}</title>
                  {xAxisId === 'accuracy' ? (
                    <>
                      <line x1={xScale(datum.accuracyInterval.lower)} x2={xScale(datum.accuracyInterval.upper)} y1={cy} y2={cy} />
                      <line x1={xScale(datum.accuracyInterval.lower)} x2={xScale(datum.accuracyInterval.lower)} y1={cy - 3} y2={cy + 3} />
                      <line x1={xScale(datum.accuracyInterval.upper)} x2={xScale(datum.accuracyInterval.upper)} y1={cy - 3} y2={cy + 3} />
                    </>
                  ) : null}
                  {yAxisId === 'accuracy' ? (
                    <>
                      <line x1={cx} x2={cx} y1={yScale(datum.accuracyInterval.lower)} y2={yScale(datum.accuracyInterval.upper)} />
                      <line x1={cx - 3} x2={cx + 3} y1={yScale(datum.accuracyInterval.lower)} y2={yScale(datum.accuracyInterval.lower)} />
                      <line x1={cx - 3} x2={cx + 3} y1={yScale(datum.accuracyInterval.upper)} y2={yScale(datum.accuracyInterval.upper)} />
                    </>
                  ) : null}
                </g>
              ) : null}
              {/* Invisible hit target in SVG space (avoids HTML/SVG coordinate drift). */}
              <rect
                data-export-ignore=""
                x={cx - 14}
                y={cy - 14}
                width={28}
                height={28}
                className="fill-transparent"
                onMouseEnter={() => {
                  setActive({
                    id: datum.id,
                    model: modelText,
                    agent: agentText,
                    reasoningEffort: datum.reasoningEffort,
                    cost:
                      datum.cost == null
                        ? '—'
                        : PARETO_AXES.cost.format(datum.cost),
                    tokens:
                      datum.tokens == null
                        ? '—'
                        : PARETO_AXES.tokens.format(datum.tokens),
                    releaseDate:
                      datum.releaseDate == null
                        ? '—'
                        : PARETO_AXES.release_date.format(datum.releaseDate),
                    accuracyIntervalLabel: datum.accuracyIntervalLabel,
                    cx,
                    cy,
                    onFrontier: datum.onFrontier,
                  });
                  setTipOpen(true);
                }}
                onMouseLeave={() => setTipOpen(false)}
              />
              <rect
                x={cx - half}
                y={cy - half}
                width={size}
                height={size}
                fill={datum.onFrontier ? accentColor : undefined}
                className={
                  datum.onFrontier
                    ? undefined
                    : active?.id === datum.id
                      ? 'fill-foreground'
                      : 'fill-muted-foreground/35'
                }
                style={{ pointerEvents: 'none' }}
              />
              {datum.onFrontier ? (
                <text
                  x={labelX}
                  y={agentText ? cy - 2 : cy + 4}
                  textAnchor={labelOnLeft ? 'end' : 'start'}
                  dominantBaseline="auto"
                  className="fill-foreground"
                  style={{ pointerEvents: 'none' }}
                >
                  <tspan x={labelX} fontSize={12} fontWeight={500}>
                    {modelText}
                  </tspan>
                  {agentText ? (
                    <tspan
                      x={labelX}
                      dy={12}
                      className="fill-muted-foreground"
                      fontSize={10}
                      fontWeight={400}
                    >
                      {agentText}
                    </tspan>
                  ) : null}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <Tooltip
        open={tipOpen}
        onOpenChange={setTipOpen}
        onOpenChangeComplete={(open) => {
          // Keep anchor/content until the close animation finishes so it
          // doesn't jump to the top-left while fading out.
          if (!open) setActive(null);
        }}
      >
        <TooltipTrigger
          data-export-ignore=""
          type="button"
          tabIndex={-1}
          delay={0}
          aria-hidden
          className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 opacity-0"
          style={{
            left: active?.cx ?? 0,
            top: active?.cy ?? 0,
          }}
        />
        <TooltipContent
          side="top"
          sideOffset={10}
          className={cn(
            'min-w-40',
          )}
          arrowStyle={
            active?.onFrontier
              ? {
                  backgroundColor: accentColor,
                  fill: accentColor,
                }
              : undefined
          }
          style={
            active?.onFrontier
              ? {
                  backgroundColor: accentColor,
                  borderColor: accentColor,
                  color: 'white',
                }
              : undefined
          }
        >
          {active ? (
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <p>{active.model}</p>
                {active.agent ? (
                  <p className="opacity-70">{active.agent}</p>
                ) : null}
                <p className="opacity-70">{active.reasoningEffort ?? '—'}</p>
              </div>
              <div className="shrink-0 text-right tabular-nums opacity-70">
                <p>{active.accuracyIntervalLabel}</p>
                <p>{active.cost}</p>
                <p>{active.tokens}</p>
                <p>{active.releaseDate}</p>
              </div>
            </div>
          ) : null}
        </TooltipContent>
      </Tooltip>
      </div>
    </div>
  );
}
