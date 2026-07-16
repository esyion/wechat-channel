import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: appName,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      {
        text: 'Quick Start',
        url: '/docs/quick-start',
        active: 'nested-url',
      },
      {
        text: 'Storage',
        url: '/docs/storage',
        active: 'nested-url',
      },
      {
        text: 'Examples',
        url: '/docs/examples',
        active: 'nested-url',
      },
    ],
  };
}
