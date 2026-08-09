'use client';

import { useQueryState } from 'nuqs';
import type { ReactNode } from 'react';

import { DomainRadarView } from '@/components/charts/domain-radar-view';
import { ParetoView } from '@/components/charts/pareto-view';
import {
  parseHomeView,
  type HomeViewId,
} from '@/components/home-view-toggle';
import { TaskActions } from '@/components/task-actions';

type HomeViewProps = {
  leaderboard: ReactNode;
};

function ViewContent({
  view,
  leaderboard,
}: {
  view: HomeViewId;
  leaderboard: ReactNode;
}) {
  switch (view) {
    case 'leaderboard':
      return leaderboard;
    case 'pareto':
      return <ParetoView />;
    case 'domains':
      return <DomainRadarView />;
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

export function HomeView({ leaderboard }: HomeViewProps) {
  const [view] = useQueryState('view', parseHomeView);

  return (
    <div className="flex w-full min-w-0 flex-col items-center gap-6">
      <ViewContent view={view} leaderboard={leaderboard} />
      <TaskActions />
    </div>
  );
}
