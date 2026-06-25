import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * In-process tracker of how many agent runs are currently in flight. Every run
 * goes through runTurn, which brackets itself with activityBegin/activityEnd, so
 * the count is authoritative. Two consumers:
 *   - the dev watcher (scripts/dev-bot.mjs): when CCT_DEV_GUARD=1 we mirror the
 *     count to a .dev-busy lock file so it defers source-change restarts until a
 *     run finishes (an agent can edit this repo's own source mid-run);
 *   - the self-update manager (selfUpdate.ts): it awaits whenIdle() before it
 *     rebuilds + restarts, so a running task is never recompiled or interrupted.
 */
const DEV_LOCK = process.env.CCT_DEV_GUARD === "1";
const LOCK = resolve(process.cwd(), ".dev-busy");

let active = 0;
let idleWaiters: Array<() => void> = [];

// A lock left by a previously-killed dev process is stale on boot — clear it so
// the watcher isn't blocked forever.
if (DEV_LOCK && existsSync(LOCK)) {
  try {
    unlinkSync(LOCK);
  } catch {
    /* best effort */
  }
}

function writeLock(): void {
  if (!DEV_LOCK) return;
  try {
    if (active === 0) {
      if (existsSync(LOCK)) unlinkSync(LOCK);
    } else {
      writeFileSync(LOCK, String(active));
    }
  } catch {
    /* best effort */
  }
}

/** Mark a run as in-flight. */
export function activityBegin(): void {
  active++;
  writeLock();
}

/** Release a run; fires any idle waiters once the last run finishes. */
export function activityEnd(): void {
  active = Math.max(0, active - 1);
  writeLock();
  if (active === 0 && idleWaiters.length) {
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  }
}

/** True while at least one run is in flight. */
export function isActive(): boolean {
  return active > 0;
}

/** Resolve when no run is in flight.
 *
 * Always yields at least one event-loop tick before checking, so callers that
 * are invoked from within the same microtask frame as activityEnd() (e.g.
 * self_update fired at the tail of a turn) don't see a spurious idle signal
 * before the turn's finally-block has fully settled.
 */
export function whenIdle(): Promise<void> {
  return new Promise((res) => {
    setImmediate(() => {
      if (active === 0) {
        res();
      } else {
        idleWaiters.push(res);
      }
    });
  });
}
