import { useState } from "react";

interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  ts: number;
}
interface ErrorEntry {
  message: string;
  phase?: string;
  ts: number;
}

interface Props {
  logs: LogEntry[];
  errors: ErrorEntry[];
}

export function LogsPanel({ logs, errors }: Props) {
  const [logsOpen, setLogsOpen] = useState(true);
  const [errorsOpen, setErrorsOpen] = useState(true);

  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString();

  return (
    <>
      <div className="card">
        <div
          className={`collapsible-header ${logsOpen ? "open" : ""}`}
          onClick={() => setLogsOpen((o) => !o)}
        >
          <h3 className="card-title" style={{ margin: 0 }}>日志 ({logs.length})</h3>
          <span className="chev">›</span>
        </div>
        {logsOpen && (
          logs.length === 0 ? (
            <p className="muted small" style={{ margin: "8px 0 0" }}>暂无日志</p>
          ) : (
            <div className="log-list">
              {logs.slice().reverse().map((l, i) => (
                <div key={i} className={`log-item ${l.level}`}>
                  <span className="ts">{fmtTime(l.ts)}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            </div>
          )
        )}
      </div>

      {errors.length > 0 && (
        <div className="card">
          <div
            className={`collapsible-header ${errorsOpen ? "open" : ""}`}
            onClick={() => setErrorsOpen((o) => !o)}
          >
            <h3 className="card-title" style={{ margin: 0 }}>错误 ({errors.length})</h3>
            <span className="chev">›</span>
          </div>
          {errorsOpen && (
            <div className="log-list">
              {errors.slice().reverse().map((e, i) => (
                <div key={i} className="log-item error">
                  <span className="ts">{fmtTime(e.ts)}</span>
                  {e.phase && <span style={{ color: "var(--text-subtle)" }}>[{e.phase}]</span>}
                  <span>{e.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
