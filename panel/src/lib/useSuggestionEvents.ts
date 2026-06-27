import { useEffect, useRef } from "react";
import { openHealthSocket, type Suggestion } from "../api.ts";

/**
 * Subscribe to live suggestion-inbox updates over the shared /ws. The server
 * broadcasts the full list on every change ({ type: "suggestion", suggestions });
 * we hand it to `onUpdate` so the view can replace its state wholesale.
 */
export function useSuggestionEvents(onUpdate: (list: Suggestion[]) => void): void {
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  const cbRef = useRef(onUpdate);
  cbRef.current = onUpdate;

  useEffect(() => {
    let closed = false;
    let ws: WebSocket;

    const connect = () => {
      if (closed) return;
      ws = openHealthSocket();
      ws.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          if (parsed.type !== "suggestion") return;
          cbRef.current(parsed.suggestions as Suggestion[]);
        } catch {
          /* ignore non-JSON / unrelated frames */
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
}
