import { useEffect, useRef, useState } from "react";
import type { PendingMedia, PublicMessage } from "../shared/types";
import { ApiError, apiPost, apiUpload } from "../hooks/useApi";

interface Props {
  messages: PublicMessage[];
  channelRunning: boolean;
}

export function MessageList({ messages, channelRunning }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(messages.length);
  const [nearBottom, setNearBottom] = useState(true);
  const [autoFollow, setAutoFollow] = useState(true);

  // Smart auto-scroll: only follow if user is already near the bottom AND has
  // auto-follow enabled. Otherwise surface a "Jump to latest" button.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lastCountRef.current;
    lastCountRef.current = messages.length;
    if (grew && autoFollow && nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, autoFollow, nearBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    setNearBottom(dist < 80);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAutoFollow(true);
    setNearBottom(true);
  }

  return (
    <div className="messages-shell">
      <div className="messages-toolbar">
        <div className="row">
          <h2>消息</h2>
          <span className="count">{messages.length}</span>
          {!channelRunning && <span className="muted small">· 通道未运行</span>}
        </div>
        <label className="row" style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={autoFollow}
            onChange={(e) => setAutoFollow(e.target.checked)}
            style={{ accentColor: "var(--accent)" }}
          />
          跟随最新
        </label>
      </div>

      <div className="messages-list" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <EmptyState channelRunning={channelRunning} />
        ) : (
          messages.map((m) => <MessageRow key={m.id} msg={m} disabled={!channelRunning} />)
        )}
      </div>

      {!nearBottom && autoFollow && (
        <button type="button" className="jump-latest" onClick={jumpToLatest}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
          跳到最新
        </button>
      )}
    </div>
  );
}

function EmptyState({ channelRunning }: { channelRunning: boolean }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">💬</div>
      <p style={{ margin: 0, fontWeight: 500 }}>
        {channelRunning ? "等待消息中…" : "通道未运行"}
      </p>
      <p className="small muted" style={{ margin: 0, maxWidth: 360 }}>
        {channelRunning
          ? "长轮询已建立 · 好友发消息后会立刻出现在这里"
          : "完成扫码登录并启动通道后,这里会显示收到的微信消息"}
      </p>
    </div>
  );
}

function initials(userId: string): string {
  // First two alphanumeric chars, uppercase. Falls back to "?" for non-ASCII.
  const m = userId.match(/[A-Za-z0-9]/g);
  if (m && m.length >= 2) return (m[0]! + m[1]!).toUpperCase();
  return (userId[0] ?? "?").toUpperCase();
}

function MessageRow({ msg, disabled }: { msg: PublicMessage; disabled: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<PendingMedia | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed && !pending) return;

    setBusy(true);
    setTyping(false);
    setError(null);
    try {
      if (pending?.serverPath) {
        // Media reply — text becomes caption (allowed to be empty)
        await apiPost("/api/reply/media", {
          messageId: msg.id,
          mediaPath: pending.serverPath,
          ...(trimmed ? { caption: trimmed } : {}),
        });
      } else if (trimmed) {
        await apiPost("/api/reply", { messageId: msg.id, text: trimmed });
      }
      setText("");
      setPending(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleTyping(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/typing", { messageId: msg.id, typing: on });
      setTyping(on);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setTyping(false);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(msg.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);

    // Build a local preview immediately for images (no upload yet)
    const isImage = file.type.startsWith("image/");
    let localPreview: string | null = null;
    if (isImage) {
      localPreview = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("FileReader failed"));
        reader.readAsDataURL(file);
      });
    }

    try {
      const uploaded = await apiUpload(file);
      setPending({
        localPreview,
        mime: uploaded.mime || file.type,
        name: uploaded.name,
        size: uploaded.size,
        serverPath: uploaded.path,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  function clearPending() {
    setPending(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const placeholder = disabled
    ? "通道未运行"
    : pending
      ? "为附件添加说明(可选)…"
      : "回复消息…";

  const sendDisabled = disabled || busy || (!text.trim() && !pending);

  return (
    <div className="msg">
      <div className="msg-avatar">{initials(msg.fromUserId)}</div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="msg-author">{msg.fromUserId}</span>
          <span className="msg-time">{new Date(msg.receivedAt).toLocaleTimeString()}</span>
          <span className="msg-token" title={msg.contextToken}>
            {msg.contextToken.slice(0, 8)}
          </span>
        </div>

        <div className="msg-bubble">
          {msg.text ? msg.text : <span className="muted">(无文本)</span>}
          <div className="msg-actions">
            <button type="button" className={copied ? "copied" : ""} onClick={copy}>
              {copied ? "✓ 已复制" : "复制"}
            </button>
          </div>
        </div>

        {msg.media.length > 0 && (
          <div className="msg-media">
            {msg.media.map((m, i) => (
              <span key={i} className="msg-media-item">{m.mime} · {m.path.split("/").pop()}</span>
            ))}
          </div>
        )}

        {typing && (
          <div className="msg-reply">
            <div className="typing"><span /><span /><span /></div>
          </div>
        )}

        <div className="msg-reply">
          {pending && <PendingMediaPreview pending={pending} onClear={clearPending} />}

          <div className="row">
            <input
              type="file"
              ref={fileInputRef}
              onChange={onFile}
              style={{ display: "none" }}
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
            />
            <button
              type="button"
              className="btn ghost icon"
              title="附加文件 / 图片 / 视频"
              disabled={disabled || busy}
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input
              type="text"
              className="input"
              value={text}
              placeholder={placeholder}
              disabled={disabled || busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            />
            <button type="button" className="btn primary" onClick={send} disabled={sendDisabled}>
              {pending ? "发送媒体" : "发送"}
            </button>
          </div>
          {!disabled && (
            <div className="row" style={{ marginTop: 6 }}>
              {!typing ? (
                <button type="button" className="btn ghost sm" onClick={() => toggleTyping(true)} disabled={busy}>
                  正在输入…
                </button>
              ) : (
                <button type="button" className="btn sm" onClick={() => toggleTyping(false)} disabled={busy}>
                  停止输入
                </button>
              )}
              {error && <span className="error-text">{error}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PendingMediaPreview({ pending, onClear }: { pending: PendingMedia; onClear: () => void }) {
  const sizeKB = (pending.size / 1024).toFixed(1);
  return (
    <div className="pending-media">
      {pending.localPreview ? (
        <img src={pending.localPreview} alt={pending.name} className="pending-thumb" />
      ) : (
        <div className="pending-icon">
          {pending.mime.startsWith("video/") ? "🎬" : pending.mime.startsWith("audio/") ? "🎵" : "📎"}
        </div>
      )}
      <div className="pending-info">
        <div className="pending-name">{pending.name}</div>
        <div className="pending-meta subtle small">
          {pending.mime} · {sizeKB} KB
          {!pending.serverPath && " · 上传中…"}
        </div>
      </div>
      <button type="button" className="btn ghost icon" onClick={onClear} title="移除附件" aria-label="Remove attachment">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
