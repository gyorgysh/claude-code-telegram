import { useCallback, useEffect, useRef } from "react";
import { openHealthSocket } from "../api.ts";

type TerminalFrame =
  | { type: "terminal"; event: "history"; data: string }
  | { type: "terminal"; event: "data"; data: string }
  | { type: "terminal"; event: "exit"; exitCode: number };

export interface TerminalSocketHandlers {
  onData: (data: string) => void;
  onExit: (code: number) => void;
}

/**
 * Subscribe to terminal output frames over the shared /ws connection.
 * Returns a stable `send` function to write keystrokes back to the PTY.
 */
export function useTerminalSocket(handlers: TerminalSocketHandlers): {
  send: (data: string) => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      ws = openHealthSocket();
      wsRef.current = ws;

      ws.onmessage = (e) => {
        let frame: TerminalFrame;
        try {
          const parsed = JSON.parse(e.data as string);
          if (parsed?.type !== "terminal") return;
          frame = parsed as TerminalFrame;
        } catch {
          return;
        }
        if (frame.event === "history" || frame.event === "data") {
          handlersRef.current.onData(frame.data);
        } else if (frame.event === "exit") {
          handlersRef.current.onExit(frame.exitCode);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!closed) retryTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(retryTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, []);

  // Stable identity so consumers can list it in effect deps without churn
  // (a fresh closure each render would repeatedly re-bind xterm's onData).
  const send = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "terminal", event: "input", data }));
    }
  }, []);

  return { send };
}
