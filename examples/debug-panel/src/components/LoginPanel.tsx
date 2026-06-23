import { useState } from "react";
import type { AppStatus } from "../shared/types";
import { ApiError, apiPost } from "../hooks/useApi";

type RenderMode = "png" | "svg" | "terminal";

interface Props {
  status: AppStatus | null;
}

export function LoginPanel({ status }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RenderMode>("png");

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/login/start");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/login/cancel");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const phase = status?.phase ?? "idle";

  return (
    <div className="card">
      <h3 className="card-title">登录</h3>

      {phase === "channel_running" && (
        <div className="col">
          <p className="muted small" style={{ margin: 0 }}>通道在运行 · 先停止通道再重新登录</p>
          <span className="pill pill-channel_running">{phase}</span>
        </div>
      )}

      {phase !== "channel_running" && phase !== "login_pending" && (
        <div className="col">
          <p className="muted small" style={{ margin: 0 }}>尚未登录 · 生成二维码并用手机微信扫描</p>
          <button type="button" className="btn primary" onClick={start} disabled={busy}>
            {busy ? "处理中…" : "开始扫码登录"}
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {phase === "login_pending" && status?.qr && (
        <div className="col">
          <div className="row" style={{ marginBottom: 0 }}>
            <span className="pill pill-login_pending">等待扫码</span>
            <span className="muted small">用微信扫一扫</span>
          </div>

          <div className="qr-tabs">
            <button type="button" className={mode === "png" ? "active" : ""} onClick={() => setMode("png")}>PNG</button>
            <button type="button" className={mode === "svg" ? "active" : ""} onClick={() => setMode("svg")}>SVG</button>
            <button type="button" className={mode === "terminal" ? "active" : ""} onClick={() => setMode("terminal")}>终端</button>
          </div>

          {mode === "png" && (
            <div className="qr-stage">
              <img src={status.qr.dataURL} alt="WeChat login QR" />
            </div>
          )}
          {mode === "svg" && (
            <div className="qr-stage">
              <div className="qr-svg" dangerouslySetInnerHTML={{ __html: status.qr.svg }} />
            </div>
          )}
          {mode === "terminal" && (
            <pre className="qr-terminal">{status.qr.terminal}</pre>
          )}

          <button type="button" className="btn danger sm" onClick={cancel} disabled={busy}>
            取消登录
          </button>
          {error && <p className="error-text">{error}</p>}
        </div>
      )}

      {phase === "logged_in" && status?.credentials?.botToken && status?.credentials?.accountId && (
        <div className="col">
          <span className="pill pill-logged_in">已登录 · 待启动</span>
          <div className="credentials">
            <div><span className="subtle">botToken:</span> {status.credentials.botToken.slice(0, 12)}…</div>
            <div><span className="subtle">accountId:</span> {status.credentials.accountId}</div>
          </div>
        </div>
      )}

      {phase === "error" && status?.error && (
        <div className="error-banner">
          <span>⚠</span>
          <span>{status.error.message}</span>
        </div>
      )}
    </div>
  );
}
