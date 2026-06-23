import { useEventStream } from "./hooks/useEventStream";
import { useTheme } from "./hooks/useTheme";
import { LoginPanel } from "./components/LoginPanel";
import { ChannelStatus } from "./components/ChannelStatus";
import { MessageList } from "./components/MessageList";
import { LogsPanel } from "./components/LogsPanel";
import { ThemeToggle } from "./components/ThemeToggle";
import "./App.css";

function App() {
  const stream = useEventStream();
  const theme = useTheme();

  return (
    <div className="app">
      <header className="app-header">
        <h1>@wechat/channel · 调试面板</h1>
        <div className="header-actions">
          <span className={`conn ${stream.connected ? "on" : "off"}`}>
            {stream.connected ? "SSE 已连接" : "SSE 断开"}
          </span>
          <ThemeToggle value={theme.value} onToggle={theme.toggle} />
        </div>
      </header>

      <aside className="app-sidebar">
        <LoginPanel status={stream.status} />
        <ChannelStatus status={stream.status} />
        <LogsPanel logs={stream.logs} errors={stream.errors} />
      </aside>

      <main className="app-main">
        {stream.status ? (
          <MessageList messages={stream.messages} channelRunning={stream.status.channelRunning} />
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon">⏳</div>
            <p style={{ margin: 0, fontWeight: 500 }}>等待后端响应…</p>
            <p className="small muted" style={{ margin: 0 }}>确认 <code className="mono">pnpm server</code> 在 3001 端口运行</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
