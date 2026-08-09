'use client';

import { useState } from 'react';

import {
  chartRowLabel,
  type ChartRowLabel,
} from '@/components/charts/chart-labels';
import type { LeaderboardRow } from '@/lib/leaderboard';
import { cn } from '@/lib/utils';

export const DOMAIN_AXES = [
  { id: 'life', label: 'Life Sciences' },
  { id: 'earth', label: 'Earth Sciences' },
  { id: 'engineering', label: 'Engineering Sciences' },
  { id: 'mathematical', label: 'Mathematical Sciences' },
  { id: 'physical', label: 'Physical Sciences' },
] as const;

export type DomainAxisId = (typeof DOMAIN_AXES)[number]['id'];
export type DomainScores = Record<DomainAxisId, number>;

export type DomainRadarDatum = {
  id: string;
  label: ChartRowLabel;
  scores: DomainScores;
  color: string;
};

const RADAR_COLORS = [
  '#038f99',
  '#6d5bd0',
  '#c45825',
  '#2e7d4f',
  '#b04a78',
  '#3c75b5',
  '#8a6b16',
  '#8b4f9e',
] as const;
const SIZE = 520;
const CENTER = SIZE / 2;
const RADIUS = 170;
const GRID_STEPS = [20, 40, 60, 80, 100];

function hashString(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A stable temporary score so profiles do not shift while filters change. */
export function domainScore(rowId: string, axisId: DomainAxisId): number {
  return 30 + (hashString(`${rowId}:${axisId}`) % 71);
}

export function buildDomainRadarData(
  rows: LeaderboardRow[],
): DomainRadarDatum[] {
  return rows.map((row) => ({
    id: row.id,
    label: chartRowLabel(row),
    scores: Object.fromEntries(
      DOMAIN_AXES.map((axis) => [axis.id, domainScore(row.id, axis.id)]),
    ) as DomainScores,
    color: RADAR_COLORS[hashString(row.id) % RADAR_COLORS.length]!,
  }));
}

type Point = {
  x: number;
  y: number;
};

function pointAt(radius: number, index: number): Point {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / DOMAIN_AXES.length;
  return {
    x: CENTER + Math.cos(angle) * radius,
    y: CENTER + Math.sin(angle) * radius,
  };
}

function pointsToString(points: Point[]): string {
  return points.map(({ x, y }) => `${x},${y}`).join(' ');
}

function gridPoints(value: number): string {
  return pointsToString(
    DOMAIN_AXES.map((_, index) => pointAt((RADIUS * value) / 100, index)),
  );
}

function profilePoints(scores: DomainScores): string {
  return pointsToString(
    DOMAIN_AXES.map((axis, index) =>
      pointAt((RADIUS * scores[axis.id]) / 100, index),
    ),
  );
}

type DomainRadarChartProps = {
  data: DomainRadarDatum[];
  className?: string;
  id?: string;
};

export function DomainRadarChart({
  data,
  className,
  id,
}: DomainRadarChartProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const highlightedDatum = data.find(
    (datum) => datum.id === (activeId ?? selectedId),
  );

  if (data.length === 0) {
    return (
      <p className="px-4 py-16 text-center text-sm text-muted-foreground">
        No leaderboard rows match the current filters.
      </p>
    );
  }

  return (
    <div id={id} className={className}>
      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center">
      <svg
        viewBox="-80 -50 680 620"
        role="img"
        aria-label="Radar chart of deterministic placeholder scores across five science domains"
        className="block w-full max-w-[620px] md:w-[calc(100%-14rem)] md:flex-1"
      >
        <title>Domain radar chart</title>
        {GRID_STEPS.map((step) => (
          <polygon
            key={step}
            points={gridPoints(step)}
            fill="none"
            className="stroke-border"
            strokeWidth={step === 100 ? 1.5 : 1}
          />
        ))}
        {DOMAIN_AXES.map((axis, index) => {
          const end = pointAt(RADIUS, index);
          const sideLabel =
            axis.id === 'physical' || axis.id === 'earth';
          const label = pointAt(
            RADIUS + (sideLabel ? 24 : axis.id === 'life' ? 26 : 34),
            index,
          );
          return (
            <g key={axis.id}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={end.x}
                y2={end.y}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor={
                  axis.id === 'earth'
                    ? 'start'
                    : axis.id === 'physical'
                      ? 'end'
                      : 'middle'
                }
                dominantBaseline="central"
                className="fill-muted-foreground font-medium uppercase"
                fontSize={13}
              >
                {axis.label}
              </text>
            </g>
          );
        })}
        {GRID_STEPS.slice(0, -1).map((step) => (
          <text
            key={`score-${step}`}
            x={CENTER + 7}
            y={CENTER - (RADIUS * step) / 100 + 4}
            className="fill-muted-foreground"
            fontSize={10}
          >
            {step}
          </text>
        ))}
        {data.map((datum) => {
          const isActive = activeId === datum.id || selectedId === datum.id;
          const isDimmed =
            (activeId != null || selectedId != null) && !isActive;
          return (
            <polygon
              key={datum.id}
              points={profilePoints(datum.scores)}
              fill="none"
              stroke={isActive ? '#038f99' : '#9ca3af'}
              strokeWidth={isActive ? 3 : 1.5}
              className={cn(
                'cursor-default outline-none transition-opacity',
                isDimmed && 'opacity-25',
              )}
              tabIndex={0}
              aria-label={`${datum.label.full}: ${DOMAIN_AXES.map(
                (axis) => `${axis.label} ${datum.scores[axis.id]}`,
              ).join(', ')}`}
              onMouseEnter={() => setActiveId(datum.id)}
              onMouseLeave={() => setActiveId(null)}
              onFocus={() => setActiveId(datum.id)}
              onBlur={() => setActiveId(null)}
              onClick={() =>
                setSelectedId((selected) =>
                  selected === datum.id ? null : datum.id,
                )
              }
            />
          );
        })}
        {highlightedDatum
          ? DOMAIN_AXES.map((axis, index) => {
              const score = highlightedDatum.scores[axis.id];
              const point = pointAt((RADIUS * score) / 100, index);
              const side =
                axis.id === 'earth'
                  ? 'right'
                  : axis.id === 'physical'
                    ? 'left'
                    : axis.id === 'life'
                      ? 'top'
                      : 'bottom';
              return (
                <text
                  key={`score-${axis.id}`}
                  x={point.x + (side === 'right' ? 8 : side === 'left' ? -8 : 0)}
                  y={point.y + (side === 'top' ? -8 : side === 'bottom' ? 14 : 4)}
                  textAnchor={
                    side === 'right'
                      ? 'start'
                      : side === 'left'
                        ? 'end'
                        : 'middle'
                  }
                  className="fill-[#038f99] font-medium"
                  fontSize={11}
                >
                  {score}%
                </text>
              );
            })
          : null}
      </svg>
      <div className="w-full rounded-xl border bg-card p-2 md:w-52 md:shrink-0">
        <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">
          MODELS
        </p>
        <ul className="grid grid-cols-1 gap-0.5 text-xs text-muted-foreground">
          {data.map((datum) => (
            <li key={datum.id} className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                className={cn(
                  'flex w-full min-w-0 rounded-md px-2 py-1.5 text-left hover:bg-muted hover:text-foreground',
                  (selectedId === datum.id || activeId === datum.id) &&
                    'text-[#038f99]',
                )}
                onMouseEnter={() => setActiveId(datum.id)}
                onMouseLeave={() => setActiveId(null)}
                onClick={() =>
                  setSelectedId((selected) =>
                    selected === datum.id ? null : datum.id,
                  )
                }
              >
                <span className="truncate">{datum.label.full}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      </div>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Domain radar across Terminal-Bench Science 0.1 tasks
      </p>
    </div>
  );
}
