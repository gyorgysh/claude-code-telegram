import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log } from "../logger.js";

const execFileAsync = promisify(execFile);

// On Windows the Claude CLI is `claude.cmd`, unlaunchable by execFile without a
// shell — so this probe always failed there. Resolve the right binary + mode.
const CLAUDE_CLI = process.platform === "win32" ? "claude.cmd" : "claude";
const CLAUDE_EXEC_OPTS = { shell: process.platform === "win32" } as const;

const CLAUDE_DIR = join(homedir(), ".claude");
const STATS_FILE = join(CLAUDE_DIR, "stats-cache.json");
const SESSIONS_DIR = join(CLAUDE_DIR, "sessions");

export interface ClaudeAccount {
  loggedIn: boolean;
  email?: string;
  subscriptionType?: string;
  authMethod?: string;
}

export interface DailyActivity {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
}

export interface ModelTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  costUSD: number;
}

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  status: string;
  version?: string;
}

export interface UsageWindow {
  /** Raw count for this window. */
  count: number;
  /** Baseline (7-day or 4-week average) used for the progress bar. */
  baseline: number;
  /** count / baseline × 100. Can exceed 100. */
  pctOfBaseline: number;
  /** ISO string of when this window resets. */
  resetsAt: string;
  /** Human description, e.g. "resets midnight" or "resets Monday". */
  resetsLabel: string;
  /** Milliseconds until reset. */
  resetsInMs: number;
}

export interface ClaudeUsageSnapshot {
  account: ClaudeAccount;
  /** Most recent recorded day from stats-cache.json (may be yesterday or older). */
  lastRecordedDay?: DailyActivity;
  /** Today's date in local time (stats may not include it yet if sessions are active). */
  todayDate: string;
  /** Whether today has recorded data (false when sessions are still active). */
  hasTodayData: boolean;
  /** Daily usage window (last recorded day vs 7-day avg). */
  daily: UsageWindow;
  /** Weekly usage window (last 7 days vs prev 4-week avg). */
  weekly: UsageWindow;
  /** Currently active Claude Code sessions. */
  activeSessions: ActiveSession[];
  /** Recent daily activity (last 14 days with data), newest first. */
  recentDays: DailyActivity[];
  /** Token breakdown from the last recorded day. */
  lastDayTokens: Record<string, ModelTokens>;
  /** Lifetime stats. */
  totalMessages: number;
  totalSessions: number;
  firstSessionDate?: string;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Milliseconds until the next local midnight. */
function msUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

/** Milliseconds until next Monday 00:00 local time. */
function msUntilMonday(): number {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysUntilMonday = day === 1 ? 7 : (8 - day) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilMonday, 0, 0, 0, 0);
  return monday.getTime() - now.getTime();
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "now";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

interface StatsCache {
  lastComputedDate?: string;
  dailyActivity?: DailyActivity[];
  dailyModelTokens?: Array<{ date: string; tokensByModel: Record<string, ModelTokens> }>;
  totalSessions?: number;
  totalMessages?: number;
  firstSessionDate?: string;
}

function readStatsCache(): StatsCache | null {
  if (!existsSync(STATS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATS_FILE, "utf8")) as StatsCache;
  } catch {
    return null;
  }
}

function readActiveSessions(): ActiveSession[] {
  if (!existsSync(SESSIONS_DIR)) return [];
  try {
    return readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => {
        try {
          return [JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8")) as ActiveSession];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

async function fetchAccount(): Promise<ClaudeAccount> {
  try {
    const { stdout } = await execFileAsync(CLAUDE_CLI, ["auth", "status"], { timeout: 8000, ...CLAUDE_EXEC_OPTS });
    const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return {
      loggedIn: Boolean(data.loggedIn),
      email: typeof data.email === "string" ? data.email : undefined,
      subscriptionType: typeof data.subscriptionType === "string" ? data.subscriptionType : undefined,
      authMethod: typeof data.authMethod === "string" ? data.authMethod : undefined,
    };
  } catch (err) {
    log.debug("claude auth status failed", { error: err instanceof Error ? err.message : String(err) });
    // Try reading from settings.json as fallback
    try {
      const settingsPath = join(CLAUDE_DIR, "settings.json");
      if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
        if (settings.email) {
          return {
            loggedIn: true,
            email: String(settings.email),
            subscriptionType: settings.subscriptionType as string | undefined,
          };
        }
      }
    } catch { /* ignore */ }
    return { loggedIn: false };
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

let cached: ClaudeUsageSnapshot | null = null;
let cachedAt = 0;
const CACHE_TTL = 60_000;

export async function getClaudeUsage(): Promise<ClaudeUsageSnapshot> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;

  const [account, stats] = await Promise.all([
    fetchAccount(),
    Promise.resolve(readStatsCache()),
  ]);
  const activeSessions = readActiveSessions();
  const today = localDateStr();

  const allDaily = [...(stats?.dailyActivity ?? [])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  const hasTodayData = allDaily.length > 0 && allDaily[0].date === today;
  const lastRecordedDay = allDaily[0];
  const recentDays = allDaily.slice(0, 14);

  // ---- Daily window ----
  // Baseline: 7-day average of the last 7 recorded days (excluding today if present)
  const last7 = (hasTodayData ? allDaily.slice(1) : allDaily).slice(0, 7);
  const dailyBaseline = Math.max(1, Math.round(average(last7.map((d) => d.messageCount))));
  const dailyCount = lastRecordedDay?.messageCount ?? 0;
  const midnightMs = msUntilMidnight();
  const daily: UsageWindow = {
    count: dailyCount,
    baseline: dailyBaseline,
    pctOfBaseline: Math.round((dailyCount / dailyBaseline) * 100),
    resetsAt: new Date(Date.now() + midnightMs).toISOString(),
    resetsLabel: `resets midnight (${formatDuration(midnightMs)})`,
    resetsInMs: midnightMs,
  };

  // ---- Weekly window ----
  // Sum of last 7 recorded days
  const last7Count = last7.reduce((s, d) => s + d.messageCount, 0);
  // Baseline: average of the 4 weeks before that
  const prev4w = allDaily.slice(hasTodayData ? 8 : 7, (hasTodayData ? 8 : 7) + 28);
  const weeklyBaseline = Math.max(1, Math.round(
    average(
      [0, 1, 2, 3].map((i) => {
        const w = prev4w.slice(i * 7, i * 7 + 7);
        return w.reduce((s, d) => s + d.messageCount, 0);
      }).filter((n) => n > 0),
    ),
  ));
  const mondayMs = msUntilMonday();
  const weekly: UsageWindow = {
    count: last7Count,
    baseline: weeklyBaseline,
    pctOfBaseline: Math.round((last7Count / weeklyBaseline) * 100),
    resetsAt: new Date(Date.now() + mondayMs).toISOString(),
    resetsLabel: `resets Monday (${formatDuration(mondayMs)})`,
    resetsInMs: mondayMs,
  };

  // Token breakdown from last recorded day
  const allModelTokens = stats?.dailyModelTokens ?? [];
  const lastDayTokens = allModelTokens.find((d) => d.date === lastRecordedDay?.date)?.tokensByModel ?? {};

  cached = {
    account,
    lastRecordedDay,
    todayDate: today,
    hasTodayData,
    daily,
    weekly,
    activeSessions,
    recentDays,
    lastDayTokens,
    totalMessages: stats?.totalMessages ?? 0,
    totalSessions: stats?.totalSessions ?? 0,
    firstSessionDate: stats?.firstSessionDate,
    fetchedAt: Date.now(),
  };
  cachedAt = Date.now();
  return cached;
}

export function subscriptionLabel(type?: string): string {
  if (!type) return "Unknown";
  const t = type.toLowerCase();
  if (t === "pro") return "Claude Pro";
  if (t.includes("max")) return "Claude Max";
  return type.charAt(0).toUpperCase() + type.slice(1);
}
