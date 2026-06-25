import { dirname, isAbsolute, resolve } from "node:path";
import { config } from "../config.js";
import {
  emptyUsage,
  loadState,
  saveState,
  type PersistedSession,
  type Usage,
} from "./store.js";

export type Autonomy = "supervised" | "standard" | "full";

/** @deprecated Use Autonomy. Kept for any external callers. */
export type PermissionMode = Autonomy;

export interface Session {
  /** Telegram chat id this session belongs to. */
  chatId: number;
  /** Claude Code session id for resuming context; undefined until first turn / after /new. */
  sessionId?: string;
  /** Working directory Claude operates in. */
  cwd: string;
  /** Whether a query is currently running for this chat. */
  busy: boolean;
  /** Aborts the in-flight query (wired to /stop). */
  abort?: AbortController;
  /** Tools "always allowed" without prompting (persists across restarts). */
  sessionAllowedTools: Set<string>;
  /** Bash leading-commands always allowed without prompting (e.g. "git"). */
  allowedBashCmds: Set<string>;
  /** Saved working directories for quick switching via /projects. */
  projects: string[];
  /**
   * supervised = all tools prompt the user (strictest).
   * standard   = read-only/safe tools auto-allowed, risky tools prompt (default).
   * full       = bypass all permissions (no prompts, autonomous).
   */
  autonomy: Autonomy;
  /** BCP 47 language code the agent responds in (undefined = server default). */
  language?: string;
  /** Accumulated cost/duration/turn counters (lifetime + per day). */
  usage: Usage;
}

export class SessionManager {
  private sessions = new Map<number, Session>();
  private saveTimer?: NodeJS.Timeout;
  private stateFile: string;

  /** `stateFile` defaults to STATE_FILE; a bare filename resolves next to it
   *  (so e.g. lead bots can keep their own state alongside the main one). */
  constructor(stateFile?: string) {
    this.stateFile = stateFile
      ? isAbsolute(stateFile)
        ? stateFile
        : resolve(dirname(config.STATE_FILE), stateFile)
      : config.STATE_FILE;
    for (const p of loadState(this.stateFile)) {
      this.sessions.set(p.chatId, {
        chatId: p.chatId,
        sessionId: p.sessionId,
        cwd: p.cwd,
        busy: false, // runtime-only flag; always starts clear so a hard restart can't leave a stale-busy session
        sessionAllowedTools: new Set(p.allowedTools),
        allowedBashCmds: new Set(p.allowedBashCmds),
        projects: p.projects,
        autonomy: p.autonomy,
        language: p.language,
        usage: p.usage,
      });
    }
  }

  get(chatId: number): Session {
    let s = this.sessions.get(chatId);
    if (!s) {
      s = {
        chatId,
        cwd: config.WORKDIR,
        busy: false,
        sessionAllowedTools: new Set(),
        allowedBashCmds: new Set(),
        projects: [],
        autonomy: "standard",
        usage: emptyUsage(),
      };
      this.sessions.set(chatId, s);
    }
    return s;
  }

  /** All live sessions (for shutdown / broadcast). */
  all(): Session[] {
    return [...this.sessions.values()];
  }

  /** Reset conversation context but keep cwd, autonomy and allow-list. */
  reset(chatId: number): void {
    const s = this.get(chatId);
    s.sessionId = undefined;
    this.save();
  }

  /** Abort every in-flight turn and clear all conversation context (a clean
   *  slate so the next message starts fresh, e.g. after switching models).
   *  Returns how many turns were aborted. */
  resetAll(): { sessions: number; aborted: number } {
    let aborted = 0;
    const all = this.all();
    for (const s of all) {
      if (s.busy && s.abort) {
        s.abort.abort();
        aborted++;
      }
      s.sessionId = undefined;
    }
    this.save();
    return { sessions: all.length, aborted };
  }

  /** Fold one turn's cost/duration into the session's lifetime + today buckets. */
  recordUsage(chatId: number, costUsd: number, durationMs: number): void {
    const s = this.get(chatId);
    const day = new Date().toISOString().slice(0, 10);
    const bucket = (s.usage.daily[day] ??= { turns: 0, costUsd: 0, durationMs: 0 });
    for (const t of [s.usage.total, bucket]) {
      t.turns += 1;
      t.costUsd += costUsd;
      t.durationMs += durationMs;
    }
    this.save();
  }

  /** Persist all sessions, debounced so bursts of mutations write once. */
  save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      saveState(this.all().map(toPersisted), this.stateFile);
    }, 500);
    this.saveTimer.unref?.();
  }

  /** Flush any pending debounced write immediately (used on shutdown). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    saveState(this.all().map(toPersisted), this.stateFile);
  }
}

function toPersisted(s: Session): PersistedSession {
  return {
    chatId: s.chatId,
    sessionId: s.sessionId,
    cwd: s.cwd,
    autonomy: s.autonomy,
    language: s.language,
    allowedTools: [...s.sessionAllowedTools],
    allowedBashCmds: [...s.allowedBashCmds],
    projects: s.projects,
    usage: s.usage,
  };
}

export const sessions = new SessionManager();
