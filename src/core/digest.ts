import { listTasks } from "./tasks.js";
import { memory } from "./memory.js";
import { listSkills } from "./skills.js";
import { agentUsage } from "./agentUsage.js";
import { heartbeat } from "./heartbeat.js";

/**
 * Daily digest: a tight summary of the last 24 hours of fleet activity.
 *
 * Pure data gathering — no Telegram/telegraf coupling. The bot command and any
 * scheduled job format the result for the channel they send to.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DigestData {
  /** Window start (epoch ms). */
  since: number;
  /** Cards moved to the done column in the window. */
  tasksCompleted: { id: string; title: string }[];
  /** Autonomous delegated runs that finished ok in the window. */
  runsOk: number;
  /** Autonomous delegated runs that errored in the window. */
  runsError: number;
  /** Memory entries created in the window. */
  memoriesWritten: number;
  /** Skills created or updated in the window. */
  skillsSaved: { name: string; isNew: boolean }[];
  /** Cost in USD attributed today (per-day bucket; see note in gatherDigest). */
  costUsd: number;
  /** Total agent turns today. */
  turns: number;
  /** Heartbeat alerts raised in the window. */
  alerts: { ts: number; text: string }[];
}

/**
 * Gather the last-24h activity snapshot.
 *
 * Tasks, memories, skills and alerts carry real epoch timestamps, so they are
 * filtered to a precise rolling 24h window. Usage is only bucketed per calendar
 * day (YYYY-MM-DD) in agentUsage, so cost/turns reflect *today's* spend — the
 * closest honest figure without per-hour accounting.
 */
export function gatherDigest(now = Date.now()): DigestData {
  const since = now - DAY_MS;

  // Tasks: completed = currently in the done column and touched within the window.
  const tasksCompleted: { id: string; title: string }[] = [];
  let runsOk = 0;
  let runsError = 0;
  for (const task of listTasks()) {
    if (task.column === "done" && task.updatedAt >= since) {
      tasksCompleted.push({ id: task.id, title: task.title });
    }
    const d = task.delegate;
    if (d?.endedAt && d.endedAt >= since) {
      if (d.status === "ok") runsOk += 1;
      else if (d.status === "error") runsError += 1;
    }
  }

  const memoriesWritten = memory.list().filter((e) => e.createdAt >= since).length;

  const skillsSaved: { name: string; isNew: boolean }[] = [];
  for (const sk of listSkills(true)) {
    const isNew = sk.createdAt >= since;
    if (isNew || sk.updatedAt >= since) {
      skillsSaved.push({ name: sk.name, isNew });
    }
  }

  const today = new Date(now).toISOString().slice(0, 10);
  let costUsd = 0;
  let turns = 0;
  for (const agent of agentUsage.list()) {
    const stat = agent.daily[today];
    if (stat) {
      costUsd += stat.costUsd;
      turns += stat.turns;
    }
  }

  const alerts = heartbeat
    .view()
    .alerts.filter((a) => a.ts >= since)
    .map((a) => ({ ts: a.ts, text: a.text }));

  return {
    since,
    tasksCompleted,
    runsOk,
    runsError,
    memoriesWritten,
    skillsSaved,
    costUsd,
    turns,
    alerts,
  };
}

/** True when nothing of note happened in the window. */
export function isDigestEmpty(d: DigestData): boolean {
  return (
    d.tasksCompleted.length === 0 &&
    d.runsOk === 0 &&
    d.runsError === 0 &&
    d.memoriesWritten === 0 &&
    d.skillsSaved.length === 0 &&
    d.turns === 0 &&
    d.alerts.length === 0
  );
}
