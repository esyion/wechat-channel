import Link from 'next/link';
import type { ReactNode } from 'react';

type IconProps = { className?: string };

function IconShell({ className = '', children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function ArrowRightIcon(props: IconProps) {
  return <IconShell {...props}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></IconShell>;
}

function RadioTowerIcon(props: IconProps) {
  return <IconShell {...props}><path d="M12 20v-6" /><path d="M8 20h8" /><path d="m9 14 3-8 3 8" /><path d="M5 8a9 9 0 0 1 14 0" /><path d="M8 10a5 5 0 0 1 8 0" /></IconShell>;
}

function QrIcon(props: IconProps) {
  return <IconShell {...props}><path d="M4 4h6v6H4z" /><path d="M14 4h6v6h-6z" /><path d="M4 14h6v6H4z" /><path d="M14 14h2" /><path d="M18 14h2v2" /><path d="M14 18h6" /><path d="M14 20h2" /></IconShell>;
}

function MessageIcon(props: IconProps) {
  return <IconShell {...props}><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8" /><path d="M8 13h5" /></IconShell>;
}

function DatabaseIcon(props: IconProps) {
  return <IconShell {...props}><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" /><path d="m13 9-3 4h4l-3 4" /></IconShell>;
}

function BotIcon(props: IconProps) {
  return <IconShell {...props}><rect x="5" y="8" width="14" height="10" rx="3" /><path d="M12 8V4" /><path d="M9 13h.01" /><path d="M15 13h.01" /><path d="M9 18v2" /><path d="M15 18v2" /></IconShell>;
}

function ShieldIcon(props: IconProps) {
  return <IconShell {...props}><path d="M12 3 5 6v5c0 5 3.4 8.6 7 10 3.6-1.4 7-5 7-10V6z" /><path d="m9 12 2 2 4-5" /></IconShell>;
}

const features = [
  {
    icon: QrIcon,
    title: '扫码即连',
    text: '登录二维码可输出到终端、网页或图片，确认后直接拿到接入凭证。',
  },
  {
    icon: MessageIcon,
    title: '消息回调',
    text: '用一个 onMessage 处理文本、媒体和上下文，把微信接进任意业务流。',
  },
  {
    icon: DatabaseIcon,
    title: '存储可换',
    text: 'Store 与 BotCredentialStore 都是接口，生产环境可接 Redis 或加密数据库。',
  },
  {
    icon: BotIcon,
    title: '多 Bot 管理',
    text: 'createBotManager() 支持多微信号托管，用 botId 保持来源清晰。',
  },
];

const snippets = [
  'const qr = await loginQR();',
  'const creds = await qr.waitForLogin();',
  'const channel = await createChannel({',
  '  ...creds,',
  '  onMessage: async (msg, reply) => {',
  '    await reply.text(`收到：${msg.text}`);',
  '  },',
  '});',
  'await channel.start();',
];

export default function HomePage() {
  return (
    <main className="fresh-canvas min-h-screen overflow-hidden text-slate-900">
      <section className="fresh-grid relative isolate min-h-screen px-6 py-8 sm:px-10 lg:px-16">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-gradient-to-b from-white/90 to-transparent" />
        <div className="mx-auto flex max-w-7xl flex-col gap-12">
          <header className="flex items-center justify-between rounded-full border border-slate-900/8 bg-white/70 px-5 py-3 shadow-sm backdrop-blur-md">
            <Link href="/" className="group flex items-center gap-3">
              <span className="soft-ring grid size-10 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <RadioTowerIcon className="size-5" />
              </span>
              <span>
                <span className="block text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700/80">WeChat</span>
                <span className="block text-base font-semibold tracking-tight text-slate-900">Channel</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
              <Link className="transition hover:text-emerald-700" href="/docs/quick-start">快速开始</Link>
              <Link className="transition hover:text-emerald-700" href="/docs/storage">存储</Link>
              <Link className="transition hover:text-emerald-700" href="/docs/architecture">架构</Link>
              <a className="transition hover:text-emerald-700" href="https://github.com/esyion/wechat-channel">GitHub</a>
            </nav>
          </header>

          <div className="grid items-center gap-10 py-10 lg:grid-cols-[1.04fr_0.96fr] lg:py-20">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/75 px-4 py-2 text-sm text-emerald-800 shadow-sm backdrop-blur">
                <ShieldIcon className="size-4" />
                Agent-agnostic WeChat ilink channel library
              </div>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-slate-950 sm:text-7xl lg:text-8xl">
                轻量、清晰地接入微信消息。
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600 sm:text-xl">
                @esyion/wechat-channel 封装扫码登录、长轮询、媒体加解密、回复和会话状态。文档站保持简洁，帮助开发者快速找到接入路径。
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/docs/quick-start"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-6 py-3 font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:bg-emerald-700"
                >
                  开始接入 <ArrowRightIcon className="size-4" />
                </Link>
                <Link
                  href="/docs/api-reference"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white/70 px-6 py-3 font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:text-emerald-700"
                >
                  查看 API
                </Link>
              </div>
            </div>

            <div className="fresh-card rounded-[2rem] p-4 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between border-b border-slate-900/8 pb-3 text-xs text-slate-500">
                <span className="tracking-[0.22em]">QUICK START</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">READY</span>
              </div>
              <pre className="overflow-x-auto rounded-3xl border border-slate-900/6 bg-slate-950 p-6 text-sm leading-7 text-emerald-50">
                <code>{snippets.join('\n')}</code>
              </pre>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs text-slate-500">
                <div className="rounded-2xl border border-slate-900/6 bg-white/65 p-3">
                  <div className="text-lg font-semibold text-slate-950">35s</div>
                  long-poll
                </div>
                <div className="rounded-2xl border border-slate-900/6 bg-white/65 p-3">
                  <div className="text-lg font-semibold text-slate-950">Store</div>
                  pluggable
                </div>
                <div className="rounded-2xl border border-slate-900/6 bg-white/65 p-3">
                  <div className="text-lg font-semibold text-slate-950">N≥22</div>
                  runtime
                </div>
              </div>
            </div>
          </div>

          <section className="grid gap-4 pb-12 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article key={feature.title} className="fresh-card rounded-3xl p-6 backdrop-blur transition hover:-translate-y-1 hover:border-emerald-200/70 hover:bg-white/90">
                  <Icon className="mb-5 size-6 text-emerald-700" />
                  <h2 className="text-lg font-semibold text-slate-950">{feature.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">{feature.text}</p>
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </main>
  );
}
