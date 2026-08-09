import { ArrowRight02Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';

import { buttonVariants } from '@/components/ui/button';
import {
  TERMINAL_BENCH_PACKAGE,
  harborDatasetUrl,
} from '@/lib/leaderboard';

const secondaryActionClass = `${buttonVariants({ variant: 'secondary', size: 'lg' })} hover:!bg-[#038f99]/10 hover:!text-[#027b84] dark:hover:!bg-[#038f99]/15 dark:hover:!text-[#038f99]`;

export function TaskActions() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <a
        href={harborDatasetUrl(TERMINAL_BENCH_PACKAGE)}
        target="_blank"
        rel="noreferrer"
        className={secondaryActionClass}
      >
        View the tasks
        <HugeiconsIcon icon={ArrowRight02Icon} strokeWidth={2} />
      </a>
      <a
        href="https://github.com/harbor-framework/terminal-bench-science/blob/main/CONTRIBUTING.md"
        target="_blank"
        rel="noreferrer"
        className={secondaryActionClass}
      >
        Contribute a task
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
      </a>
    </div>
  );
}
