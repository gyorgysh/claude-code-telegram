import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../api.ts";
import { useChatEvents } from "../lib/useChatEvents.ts";
import { useI18n } from "../lib/useI18n.ts";
import { Markdown } from "../lib/markdown.tsx";
import { Button } from "./ui.tsx";

export function ChatView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const { messages, stream, busy, view, setView } = useChatEvents(onAuthError);
  const [text, setText] = useState("");
  const [editingCwd, setEditingCwd] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom as the conversation grows / streams.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stream?.text]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    try {
      await api.sendChat(t);
    } catch {
      setText(t);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const toggleAuto = async () => {
    if (!view?.bypassAllowed) return;
    setView(await api.chatSettings({ auto: !view.auto }));
  };

  const saveCwd = async (cwd: string) => {
    setEditingCwd(false);
    setView(await api.chatSettings({ cwd }));
  };

  return (
    <div className="flex h-[calc(100dvh-var(--nav-h-mobile))] flex-col pb-safe md:h-[calc(100dvh-var(--nav-h-desktop))] md:pb-0">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            {t("chat_title")}
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              {t("chat_shared_badge")}
            </span>
          </h2>
          {editingCwd ? (
            <input
              autoFocus
              defaultValue={view?.cwd ?? ""}
              onBlur={(e) => void saveCwd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveCwd((e.target as HTMLInputElement).value)}
              className="mono mt-0.5 w-72 max-w-full rounded border border-line bg-input px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent"
            />
          ) : (
            <button
              onClick={() => setEditingCwd(true)}
              title={t("chat_change_cwd")}
              className="mono mt-0.5 block max-w-full truncate text-xs text-fg-dim hover:text-fg-muted"
            >
              {view?.cwd ?? "…"}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAuto}
            disabled={!view?.bypassAllowed}
            title={
              view?.bypassAllowed
                ? t("chat_toggle_auto")
                : t("chat_toggle_locked")
            }
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              view?.auto
                ? "bg-amber-500/15 text-amber-400"
                : "bg-surface-2 text-fg-dim"
            } ${view?.bypassAllowed ? "" : "cursor-not-allowed opacity-60"}`}
          >
            {!view?.bypassAllowed && <span className="mr-1">🔒</span>}
            {view?.auto ? t("chat_auto") : t("chat_safe")}
          </button>
          <Button
            variant="ghost"
            onClick={async () => view && setView(await api.clearChat())}
            disabled={busy}
          >
            {t("chat_clear")}
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 && !stream && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-fg-faint">
            <div className="mono mb-2 text-2xl text-accent">%_</div>
            {t("chat_empty")}
            <br />
            {view?.auto ? t("chat_empty_auto") : t("chat_empty_safe")}
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} m={m} />
        ))}
        {stream && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-surface px-4 py-2.5 text-sm">
              {stream.tool && (
                <div className="mono mb-1 text-xs text-fg-dim">⚙ {stream.tool}</div>
              )}
              <div className="break-words text-fg">
                <Markdown text={stream.text} />
                <span className="ml-0.5 animate-pulse text-accent">▮</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-line pt-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={1}
          placeholder={t("chat_placeholder")}
          className="max-h-40 min-h-[42px] flex-1 resize-none rounded-xl border border-line bg-input px-3 py-2.5 text-sm text-fg outline-none focus:border-accent"
        />
        {busy ? (
          <Button variant="danger" onClick={() => void api.stopChat()} className="h-[42px]">
            {t("stop")}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void send()} disabled={!text.trim()} className="h-[42px]">
            {t("chat_send")}
          </Button>
        )}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const { t } = useI18n();
  const user = m.role === "user";
  const body = m.text || (m.error ? t("chat_failed") : "");
  return (
    <div className={`flex ${user ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] break-words rounded-2xl px-4 py-2.5 text-sm ${
          user
            ? "whitespace-pre-wrap rounded-tr-sm bg-accent text-accent-fg"
            : m.error
              ? "whitespace-pre-wrap rounded-tl-sm border border-red-500/30 bg-red-500/5 text-red-400"
              : "rounded-tl-sm bg-surface text-fg"
        }`}
      >
        {user || m.error ? body : <Markdown text={body} />}
      </div>
    </div>
  );
}
