import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'wechat-channel';

/** @type {import('next').NextConfig} */
const config = {
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
  ...(isGitHubPages
    ? {
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}/`,
      }
    : {}),
};

export default withMDX(config);
