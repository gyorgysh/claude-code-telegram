import { useEffect, useRef, useState } from "react";
import { api, openHealthSocket, type WorkerRun, type TaskDelegation } from "../api.ts";

/** One in-flight run surfaced in the "What's running" strip. */
export interface ActiveRun {
  /** Stable key: "worker:<workerId>" or "task:<taskId>". */
  key: string;
  kind: "worker" | "task";
  /** workerId or taskId. */
  ownerId: string;
  runId: string;
  /** Display name (worker name / task title), resolved lazily. */
  label: string;
  startedAt: number;
  /** Latest tool the run is using, if any. */
  tool?: string;
}

type WorkerMsg =
  | { type: "worker"; event: "start" | "end"; run: WorkerRun }
  | { type: "worker"; event: "delta"; runId: string; workerId: string; delta: string }
  | { type: "worker"; event: "tool"; runId: string; workerId: string; tool: string; arg: string };

type TaskMsg =
  | { type: "task"; event: "start"; taskId: string; runId: string; column?: string }
  | { type: "task"; event: "delta"; taskId: string; runId: string; delta: string }
  | { type: "task"; event: "tool"; taskId: string; runId: string; tool: string }
  | { type: "task"; event: "queued"; taskId: string; column?: string }
  | { type: "task"; event: "queue"; paused: boolean }
  | { type: "task"; event: "end"; taskId: string; runId: string; delegate?: TaskDelegation; column?: string };

/**
 * Single shared subscription to /ws that tracks every in-flight autonomous run
 * (Lead/worker runs and delegated kanban-card runs) so a global status strip can
 * show what's happening right now. Names are resolved lazily and cached: when a
 * run starts for an id we haven't seen, we fetch the worker list / task list once
 * to label it. Runs are removed on their "end" event.
 */
export function useActiveRuns(enabled: boolean): ActiveRun[] {
  const [runs, setRuns] = useState<Record<string, ActiveRun>>({});
  const retryRef = useRef<ReturnType<typeof setTimeout>>();
  // Resolved name caches + in-flight fetch guards so we hit the API at most once
  // per kind while a label is still unknown.
  const workerNames = useRef<Record<string, string>>({});
  const taskTitles = useRef<Record<string, string>>({});
  const fetchingWorkers = useRef(false);
  const fetchingTasks = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setRuns({});
      return;
    }
    let closed = false;
    let ws: WebSocket;

    const upsert = (key: string, patch: (prev: ActiveRun | undefined) => ActiveRun) =>
      setRuns((m) => ({ ...m, [key]: patch(m[key]) }));
    const remove = (key: string) =>
      setRuns((m) => {
        if (!(key in m)) return m;
        const next = { ...m };
        delete next[key];
        return next;
      });

    const labelWorker = (id: string): string => workerNames.current[id] ?? id;
    const labelTask = (id: string): string => taskTitles.current[id] ?? id;

    const ensureWorkerName = (id: string) => {
      if (workerNames.current[id] || fetchingWorkers.current) return;
      fetchingWorkers.current = true;
      api
        .workers()
        .then((r) => {
          for (const w of r.workers) workerNames.current[w.id] = w.name;
          setRuns((m) => {
            let changed = false;
            const next: Record<string, ActiveRun> = {};
            for (const [k, run] of Object.entries(m)) {
              if (run.kind === "worker" && workerNames.current[run.ownerId]) {
                next[k] = { ...run, label: workerNames.current[run.ownerId] };
                changed = true;
              } else next[k] = run;
            }
            return changed ? next : m;
          });
        })
        .catch(() => {})
        .finally(() => {
          fetchingWorkers.current = false;
        });
    };
    const ensureTaskTitle = (id: string) => {
      if (taskTitles.current[id] || fetchingTasks.current) return;
      fetchingTasks.current = true;
      api
        .tasks()
        .then((r) => {
          for (const tk of r.tasks) taskTitles.current[tk.id] = tk.title;
          setRuns((m) => {
            let changed = false;
            const next: Record<string, ActiveRun> = {};
            for (const [k, run] of Object.entries(m)) {
              if (run.kind === "task" && taskTitles.current[run.ownerId]) {
                next[k] = { ...run, label: taskTitles.current[run.ownerId] };
                changed = true;
              } else next[k] = run;
            }
            return changed ? next : m;
          });
        })
        .catch(() => {})
        .finally(() => {
          fetchingTasks.current = false;
        });
    };

    const connect = () => {
      if (closed) return;
      ws = openHealthSocket();
      ws.onmessage = (e) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(e.data);
        } catch {
          return;
        }
        const t = (parsed as { type?: string }).type;
        if (t === "worker") {
          const msg = parsed as WorkerMsg;
          if (msg.event === "start") {
            const id = msg.run.workerId;
            ensureWorkerName(id);
            upsert(`worker:${id}`, () => ({
              key: `worker:${id}`,
              kind: "worker",
              ownerId: id,
              runId: msg.run.id,
              label: labelWorker(id),
              startedAt: msg.run.startedAt || Date.now(),
            }));
          } else if (msg.event === "tool") {
            const id = msg.workerId;
            upsert(`worker:${id}`, (prev) => ({
              key: `worker:${id}`,
              kind: "worker",
              ownerId: id,
              runId: msg.runId,
              label: prev?.label ?? labelWorker(id),
              startedAt: prev?.startedAt ?? Date.now(),
              tool: `${msg.tool} ${msg.arg}`.trim(),
            }));
          } else if (msg.event === "end") {
            remove(`worker:${msg.run.workerId}`);
          }
        } else if (t === "task") {
          const msg = parsed as TaskMsg;
          if (msg.event === "start") {
            ensureTaskTitle(msg.taskId);
            upsert(`task:${msg.taskId}`, () => ({
              key: `task:${msg.taskId}`,
              kind: "task",
              ownerId: msg.taskId,
              runId: msg.runId,
              label: labelTask(msg.taskId),
              startedAt: Date.now(),
            }));
          } else if (msg.event === "tool") {
            upsert(`task:${msg.taskId}`, (prev) => ({
              key: `task:${msg.taskId}`,
              kind: "task",
              ownerId: msg.taskId,
              runId: msg.runId,
              label: prev?.label ?? labelTask(msg.taskId),
              startedAt: prev?.startedAt ?? Date.now(),
              tool: msg.tool,
            }));
          } else if (msg.event === "end") {
            remove(`task:${msg.taskId}`);
          }
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
  }, [enabled]);

  // Stable, newest-first ordering for the strip.
  return Object.values(runs).sort((a, b) => b.startedAt - a.startedAt);
}
