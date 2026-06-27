/**
 * Single-instance guard. Prevents two `dist/index.js` processes from coexisting,
 * which is what produced the "everything runs 4x" storm: a restart
 * (launchctl kickstart / systemd) spawns a new process while the old one is still
 * draining (holding the bot token long-poll, the panel port, and a cloudflared
 * child), so schedulers/heartbeat/lead bots/tunnel all start again in the new
 * process on top of the old one's still-running copies.
 *
 * On startup we write our PID to a lockfile in the data dir. If a live PID is
 * already there, we wait a short window for it to exit (the normal restart
 * handoff case), then take over. If it never exits, we refuse to start so the two
 * can't overlap. A stale lock (PID gone, or our own from a hard kill) is taken
 * over immediately.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dataPath } from "./jsonStore.js";
import { log } from "../logger.js";

const LOCK = dataPath("instance.lock");

/** Is a process with this PID currently alive? (signal 0 = existence probe.) */
function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process (stale). EPERM = alive but not ours to signal.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLockPid(): number | null {
  if (!existsSync(LOCK)) return null;
  try {
    const pid = Number.parseInt(readFileSync(LOCK, "utf8").trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Acquire the single-instance lock. Returns a release() to call on shutdown.
 * Throws if another live instance won't yield within the wait window.
 */
export async function acquireInstanceLock(): Promise<() => void> {
  const existing = readLockPid();

  if (existing && isAlive(existing)) {
    // A restart races the old process's graceful drain. Wait for it to exit
    // before we boot, so the two never overlap. The old process now kills its
    // tunnel + releases this lock + force-exits, so this normally resolves fast.
    const WAIT_MS = 40_000;
    const STEP_MS = 250;
    log.info("Another instance is still running — waiting for it to exit", {
      pid: existing,
      waitMs: WAIT_MS,
    });
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      await sleep(STEP_MS);
      const pid = readLockPid();
      if (!pid || !isAlive(pid)) break; // it released the lock or died
    }
    const stillThere = readLockPid();
    if (stillThere && isAlive(stillThere)) {
      throw new Error(
        `another instance (pid ${stillThere}) is still running after ${WAIT_MS}ms — refusing to start a second copy`,
      );
    }
    log.info("Previous instance exited — taking over");
  } else if (existing) {
    log.info("Clearing stale instance lock", { pid: existing });
  }

  writeFileSync(LOCK, String(process.pid), { mode: 0o600 });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // Only remove the lock if it's still ours (a newer instance may have taken
    // it over already during a fast restart handoff).
    if (readLockPid() === process.pid) {
      try {
        unlinkSync(LOCK);
      } catch {
        /* best effort */
      }
    }
  };
}
