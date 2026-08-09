import { ArrowUpRight03Icon, TerminalIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import Link from 'next/link';

import { HeroTitle } from '@/components/hero-title';
import { HomeView } from '@/components/home-view';
import { LeaderboardTable } from '@/components/leaderboard/leaderboard-table';
import { buttonVariants } from '@/components/ui/button';

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-8xl flex-1 flex-col px-4 pt-12">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-6">
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="flex flex-col items-center gap-5">
            <HeroTitle />
            <p className="max-w-xl text-balance text-lg font-normal tracking-tighter text-muted-foreground">
              A benchmark for evaluating AI agents on computational workflows
              in the natural sciences
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/run"
              className={`${buttonVariants({ variant: 'default', size: 'lg' })} hover:!bg-[#038f99] hover:!text-white`}
            >
              Run Terminal-Bench Science
              <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} />
            </Link>
            <Link
              href="/announcement"
              className={`${buttonVariants({ variant: 'secondary', size: 'lg' })} hover:!bg-[#038f99]/10 hover:!text-[#027b84] dark:hover:!bg-[#038f99]/15 dark:hover:!text-[#038f99]`}
            >
              Read the announcement
              <HugeiconsIcon icon={ArrowUpRight03Icon} strokeWidth={2} />
            </Link>
          </div>
        </div>

        <HomeView leaderboard={<LeaderboardTable />} />
      </div>
    </div>
  );
}
