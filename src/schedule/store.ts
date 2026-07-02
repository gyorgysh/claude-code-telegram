import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { log } from "../logger.js";

/** When a schedule fires: a fixed interval, or a wall-clock time each day. */
export type ScheduleSpec =
  | { kind: "interval"; everyMs: number }
  | { kind: "daily"; hour: number; minute: number };

export interface Schedule {
  id: string;
  chatId: number;
  /** Working directory the autonomous turn runs in. */
  cwd: string;
  /** The prompt sent to Claude when it fires. */
  prompt: string;
  spec: ScheduleSpec;
  /** Epoch ms of the next firing. */
  nextRunAt: number;
  createdAt: number;
  lastRunAt?: number;
  /** Last error from a fire that threw, so the panel can surface a broken job.
   *  Cleared on the next successful fire. */
  lastError?: string;
  /** Epoch ms of when this schedule first became due but couldn't fire because
   *  the chat was busy. Cleared once it actually fires (or is moved to a task).
   *  Drives the "retry until free, then fall back to a background task" path. */
  busySince?: number;
  /** Paused schedules stay in the list but are skipped on tick. Defaults to enabled. */
  enabled?: boolean;
  /** Optional URL POSTed a JSON outcome payload when the run completes. */
  webhookUrl?: string;
}

// Sibling of STATE_FILE so it lives in the same gitignored data/ folder.
const FILE = join(dirname(config.STATE_FILE), "schedules.json");

interface ScheduleFile {
  version: 1;
  schedules: Schedule[];
}

export function loadSchedules(): Schedule[] {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as ScheduleFile;
    return Array.isArray(parsed?.schedules) ? parsed.schedules : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.error("Failed to read schedules; starting empty", { error: errText(err) });
      // Move a corrupt file aside before saveSchedules can overwrite it, so a
      // crash-truncated schedules.json is recoverable rather than silently lost.
      try {
        const dest = `${FILE}.corrupt-${Date.now()}`;
        renameSync(FILE, dest);
        log.warn("Quarantined corrupt schedules store", { saved: dest });
      } catch {
        /* best effort */
      }
    }
    return [];
  }
}

export function saveSchedules(schedules: Schedule[]): void {
  const data: ScheduleFile = { version: 1, schedules };
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const tmp = `${FILE}.tmp`;
    // schedules can carry prompts/cwd paths the user may consider sensitive;
    // lock the file to owner-only, matching every sibling store in data/.
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600); // enforce mode even if a stale tmp pre-existed
    renameSync(tmp, FILE);
  } catch (err) {
    log.error("Failed to persist schedules", { error: errText(err) });
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
