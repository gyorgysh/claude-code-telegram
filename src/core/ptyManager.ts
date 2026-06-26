/**
 * PtyManager — a singleton that owns one persistent PTY shell session.
 * Multiplexed to all panel WebSocket clients via the broadcast callback.
 *
 * node-pty is an optionalDependency. If it failed to build (missing
 * build-tools on the host), this module degrades gracefully: `available`
 * is false and all methods are no-ops.
 */

import { statSync } from "fs";
import { log as logger } from "../logger.js";

/** Maximum scrollback kept in memory (bytes). Sent to new clients on connect. */
const SCROLLBACK_CAP = 10_000;

/** Default shell search order. */
const SHELL_CANDIDATES = [
  process.env.SHELL,
  "/bin/bash",
  "/usr/bin/bash",
  "/bin/zsh",
  "/usr/bin/zsh",
  "/bin/sh",
].filter(Boolean) as string[];

function findShell(): string {
  for (const s of SHELL_CANDIDATES) {
    try { statSync(s); return s; } catch { /* try next */ }
  }
  return "/bin/sh";
}

type BroadcastFn = (msg: unknown) => void;
type IPty = import("node-pty").IPty;
type NodePtyModule = typeof import("node-pty");

// Attempt to load node-pty. Stored as a module-level variable resolved once.
let _ptyMod: NodePtyModule | null = null;

async function loadPty(): Promise<NodePtyModule | null> {
  if (_ptyMod) return _ptyMod;
  try {
    // Non-literal specifier so tsc doesn't try to resolve at compile time.
    const mod = await import(/* @vite-ignore */ "node-pty");
    _ptyMod = mod as NodePtyModule;
    return _ptyMod;
  } catch {
    return null;
  }
}

export class PtyManager {
  private broadcast: BroadcastFn = () => {};
  private pty: IPty | null = null;
  private scrollback = "";
  private _available: boolean | null = null;

  start(broadcast: BroadcastFn): void {
    this.broadcast = broadcast;
    // Probe availability in background.
    void loadPty().then((m) => {
      this._available = m !== null;
      if (!m) logger.warn("[pty] node-pty not available — terminal tab disabled");
    });
  }

  get available(): boolean {
    return this._available ?? false;
  }

  get availableResolved(): boolean | null {
    return this._available;
  }

  /** Current scrollback for a newly-connected client. */
  getHistory(): string {
    return this.scrollback;
  }

  get currentShell(): string {
    return findShell();
  }

  /** Lazily spawn (or re-use) the PTY process. */
  private async spawnIfNeeded(cols = 120, rows = 30): Promise<void> {
    if (this.pty) return;
    const ptyMod = await loadPty();
    if (!ptyMod) return;

    const shell = findShell();
    logger.info(`[pty] spawning ${shell} (${cols}x${rows})`);

    try {
      this.pty = ptyMod.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: process.env.HOME ?? "/",
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (e) {
      // Native spawn can fail even when the module loads (e.g. a non-executable
      // spawn-helper in the prebuild). Degrade gracefully → terminal stays disabled.
      this._available = false;
      logger.warn(`[pty] spawn failed — terminal disabled: ${(e as Error).message}`);
      return;
    }

    this.pty.onData((data) => {
      this.scrollback += data;
      if (this.scrollback.length > SCROLLBACK_CAP) {
        this.scrollback = this.scrollback.slice(this.scrollback.length - SCROLLBACK_CAP);
      }
      this.broadcast({ type: "terminal", event: "data", data });
    });

    this.pty.onExit(({ exitCode }) => {
      logger.info(`[pty] shell exited (${exitCode}) — will respawn on next input`);
      this.pty = null;
      this.scrollback = "";
      this.broadcast({ type: "terminal", event: "exit", exitCode });
    });
  }

  /** Initialise the shell (called when the first client opens the terminal tab). */
  spawn(cols = 120, rows = 30): void {
    void this.spawnIfNeeded(cols, rows);
  }

  write(data: string): void {
    if (this.pty) {
      this.pty.write(data);
    } else {
      void this.spawnIfNeeded().then(() => this.pty?.write(data));
    }
  }

  resize(cols: number, rows: number): void {
    this.pty?.resize(cols, rows);
  }

  kill(): void {
    try { this.pty?.kill(); } catch { /* ignore */ }
    this.pty = null;
  }
}

export const ptyManager = new PtyManager();
