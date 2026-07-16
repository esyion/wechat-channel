import { Geist, Geist_Mono } from 'next/font/google';
import type { Metadata } from 'next';
import { Provider } from '@/components/provider';
import './global.css';

const sans = Geist({
  subsets: ['latin'],
  variable: '--font-sans',
});

const mono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'WeChat Channel Docs',
    template: '%s | WeChat Channel',
  },
  description: 'Developer documentation for @esyion/wechat-channel, an agent-agnostic WeChat ilink channel library.',
  metadataBase: new URL('https://esyion.github.io/wechat-channel'),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
