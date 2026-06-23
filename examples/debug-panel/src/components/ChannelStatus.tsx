import { useState } from "react";
import type { AppStatus } from "../shared/types";
import { ApiError, apiPost } from "../hooks/useApi";

interface Props {
  status: AppStatus | null;
}

export function ChannelStatus({ status }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try { await apiPost("/api/channel/start"); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function stop() {
    setBusy(true);
    setError(null);
    try { await apiPost("/api/channel/stop"); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const phase = status?.phase ?? "idle";
  const running = status?.channelRunning ?? false;
  const messageCount = status?.messageCount ?? 0;

  return (
    <div className="card">
      <h3 className="card-title">通道</h3>
      <div className="status-block">
        <div className="row">
          <span className={`pill pill-${phase}`}>{phase}</span>
          <span className="muted small">{messageCount} 条消息</span>
        </div>

        <div className="row">
          {phase === "logged_in" && !running && (
            <button type="button" className="btn primary" onClick={start} disabled={busy}>
              启动通道
            </button>
          )}
          {running && (
            <button type="button" className="btn danger" onClick={stop} disabled={busy}>
              停止通道
            </button>
          )}
          {phase === "idle" && (
            <span className="muted small">尚未登录</span>
          )}
          {phase === "login_pending" && (
            <span className="muted small">等待扫码</span>
          )}
        </div>

        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}
