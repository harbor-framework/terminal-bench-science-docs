import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { SiteLogo } from '@/components/site-logo';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <SiteLogo />,
      url: '/',
    },
    links: [
      {
        text: 'RUN TERMINAL-BENCH SCIENCE',
        url: '/run',
      },
      {
        text: 'ANNOUNCEMENT',
        url: '/announcement',
      },
      {
        text: 'CONTRIBUTORS',
        url: '/contributors',
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    searchToggle: {
      enabled: false,
    },
    themeSwitch: {
      mode: 'light-dark-system',
    },
  };
}
