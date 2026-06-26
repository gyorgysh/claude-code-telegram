import { useCallback, useEffect, useRef, useState } from "react";
import { api, openHealthSocket, type ChatMessage, type ChatView } from "../api.ts";

export interface ChatStream {
  id: string;
  text: string;
  tool?: string;
}

type ChatMsg =
  | { type: "chat"; event: "user" | "end"; message: ChatMessage }
  | { type: "chat"; event: "start"; id: string }
  | { type: "chat"; event: "delta"; id: string; delta: string }
  | { type: "chat"; event: "tool"; id: string; tool: string; arg: string }
  | { type: "chat"; event: "busy"; busy: boolean }
  | { type: "chat"; event: "cleared" };

/** Subscribe to the shared chat stream over /ws and track the live conversation
 *  (mirrored from the main Telegram chat): messages, the in-flight turn, busy. */
export function useChatEvents(onAuthError: () => void) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<ChatStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ChatView | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(() => {
    api
      .chat()
      .then((v) => {
        setView(v);
        setMessages(v.messages);
        setBusy(v.busy);
      })
      .catch((e) => {
        if (e?.name === "AuthError") onAuthError();
      });
  }, [onAuthError]);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    const connect = () => {
      if (closed) return;
      ws = openHealthSocket();
      ws.onmessage = (e) => {
        let m: ChatMsg;
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.type !== "chat") return;
          m = parsed as ChatMsg;
        } catch {
          return;
        }
        switch (m.event) {
          case "user":
            setMessages((xs) => [...xs, m.message]);
            break;
          case "start":
            setStream({ id: m.id, text: "" });
            break;
          case "delta":
            setStream((s) => (s ? { ...s, text: s.text + m.delta } : { id: m.id, text: m.delta }));
            break;
          case "tool":
            setStream((s) => (s ? { ...s, tool: `${m.tool} ${m.arg}`.trim() } : s));
            break;
          case "end":
            setStream(null);
            setMessages((xs) => [...xs, m.message]);
            break;
          case "busy":
            setBusy(m.busy);
            if (!m.busy) setStream(null);
            break;
          case "cleared":
            setMessages([]);
            setStream(null);
            break;
        }
      };
      ws.onclose = () => {
        if (!closed) retryRef.current = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retryRef.current);
      ws?.close();
    };
  }, []);

  return { messages, stream, busy, view, setView, refresh };
}
