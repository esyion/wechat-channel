import Link from "next/link";
import type { ReactNode } from "react";

type IconProps = { className?: string };

function IconShell({
  className = "",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function ArrowRightIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </IconShell>
  );
}

function RadioTowerIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M12 20v-6" />
      <path d="M8 20h8" />
      <path d="m9 14 3-8 3 8" />
      <path d="M5 8a9 9 0 0 1 14 0" />
      <path d="M8 10a5 5 0 0 1 8 0" />
    </IconShell>
  );
}

function QrIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M4 4h6v6H4z" />
      <path d="M14 4h6v6h-6z" />
      <path d="M4 14h6v6H4z" />
      <path d="M14 14h2" />
      <path d="M18 14h2v2" />
      <path d="M14 18h6" />
      <path d="M14 20h2" />
    </IconShell>
  );
}

function MessageIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M4 5h16v11H8l-4 4z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </IconShell>
  );
}

function DatabaseIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
      <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
      <path d="m13 9-3 4h4l-3 4" />
    </IconShell>
  );
}

function BotIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 8V4" />
      <path d="M9 13h.01" />
      <path d="M15 13h.01" />
      <path d="M9 18v2" />
      <path d="M15 18v2" />
    </IconShell>
  );
}

function ShieldIcon(props: IconProps) {
  return (
    <IconShell {...props}>
      <path d="M12 3 5 6v5c0 5 3.4 8.6 7 10 3.6-1.4 7-5 7-10V6z" />
      <path d="m9 12 2 2 4-5" />
    </IconShell>
  );
}

const features = [
  {
    icon: QrIcon,
    title: "扫码登录",
    text: "loginQR() 输出终端、PNG、SVG 或 data URL，确认后拿到 botToken 与 accountId。",
  },
  {
    icon: MessageIcon,
    title: "一行 onMessage",
    text: "把微信长轮询消息转换成 msg + reply，AI、RAG 或业务系统都由你接。",
  },
  {
    icon: DatabaseIcon,
    title: "可替换存储",
    text: "Store 与 BotCredentialStore 都是接口，默认 JSON 文件，可换 Redis、Postgres 或加密存储。",
  },
  {
    icon: BotIcon,
    title: "多 Bot 托管",
    text: "createBotManager() 支持一套服务同时管理多个微信号，并用 botId 隔离来源。",
  },
];

const snippets = [
  "const qr = await loginQR();",
  "const creds = await qr.waitForLogin();",
  "const channel = await createChannel({",
  "  ...creds,",
  "  onMessage: async (msg, reply) => {",
  "    await reply.text(`收到：${msg.text}`);",
  "  },",
  "});",
  "await channel.start();",
];

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#020504] text-white">
      <section className="signal-grid relative isolate min-h-screen px-6 py-8 sm:px-10 lg:px-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,transparent_0,rgba(0,0,0,.58)_74%)]" />
        <div className="mx-auto flex max-w-7xl flex-col gap-12">
          <header className="flex items-center justify-between border-b border-emerald-300/15 pb-5">
            <Link href="/" className="group flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
                <RadioTowerIcon className="size-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold uppercase tracking-[0.35em] text-emerald-100/80">
                  WeChat
                </span>
                <span className="block text-lg font-semibold tracking-tight">
                  Channel
                </span>
              </span>
            </Link>
            <nav className="hidden items-center gap-6 text-sm text-emerald-50/70 md:flex">
              <Link
                className="transition hover:text-white"
                href="/docs/quick-start"
              >
                快速开始
              </Link>
              <Link
                className="transition hover:text-white"
                href="/docs/storage"
              >
                存储
              </Link>
              <Link
                className="transition hover:text-white"
                href="/docs/architecture"
              >
                架构
              </Link>
              <a
                className="transition hover:text-white"
                href="https://github.com/esyion/wechat-channel"
              >
                GitHub
              </a>
            </nav>
          </header>

          <div className="grid items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm text-emerald-100 shadow-2xl shadow-emerald-950/40">
                <ShieldIcon className="size-4" />
                Agent-agnostic WeChat ilink channel library
              </div>
              <h1 className="max-w-4xl text-5xl font-semibold leading-[0.95] tracking-tighter text-white sm:text-7xl lg:text-8xl">
                把微信消息接进任何 AI 工作流。
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-emerald-50/72 sm:text-xl">
                @esyion/wechat-channel
                封装扫码登录、长轮询、媒体加解密、回复和会话状态。开发者只需实现一个
                onMessage 回调。
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/docs/quick-start"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-300 px-6 py-3 font-semibold text-emerald-950 transition hover:bg-emerald-200"
                >
                  开始接入 <ArrowRightIcon className="size-4" />
                </Link>
                <Link
                  href="/docs/api-reference"
                  className="inline-flex items-center justify-center rounded-full border border-emerald-100/20 px-6 py-3 font-semibold text-emerald-50 transition hover:border-emerald-200/50 hover:bg-white/5"
                >
                  查看 API
                </Link>
              </div>
            </div>

            <div className="terminal-card rounded-4xl border border-emerald-200/10 bg-black/50 p-4 backdrop-blur-xl">
              <div className="mb-4 flex items-center justify-between border-b border-emerald-300/10 pb-3 text-xs text-emerald-100/60">
                <span className="tracking-[0.24em]">CHANNEL SESSION</span>
                <span className="rounded-full bg-emerald-300/10 px-2 py-1 text-emerald-200">
                  LIVE
                </span>
              </div>
              <pre className="overflow-x-auto rounded-3xl bg-[#020806] p-6 text-sm leading-7 text-emerald-100/90">
                <code>{snippets.join("\n")}</code>
              </pre>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs text-emerald-50/70">
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/5 p-3">
                  <div className="text-lg font-semibold text-emerald-200">
                    35s
                  </div>
                  long-poll
                </div>
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/5 p-3">
                  <div className="text-lg font-semibold text-emerald-200">
                    Store
                  </div>
                  pluggable
                </div>
                <div className="rounded-2xl border border-emerald-300/10 bg-emerald-300/5 p-3">
                  <div className="text-lg font-semibold text-emerald-200">
                    N≥22
                  </div>
                  runtime
                </div>
              </div>
            </div>
          </div>

          <section className="grid gap-4 pb-12 md:grid-cols-2 lg:grid-cols-4">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <article
                  key={feature.title}
                  className="rounded-3xl border border-emerald-100/10 bg-white/[0.035] p-6 backdrop-blur transition hover:-translate-y-1 hover:border-emerald-200/30 hover:bg-white/6"
                >
                  <Icon className="mb-5 size-6 text-emerald-200" />
                  <h2 className="text-lg font-semibold text-white">
                    {feature.title}
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-emerald-50/64">
                    {feature.text}
                  </p>
                </article>
              );
            })}
          </section>
        </div>
      </section>
    </main>
  );
}
