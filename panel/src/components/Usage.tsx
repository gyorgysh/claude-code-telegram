import { useEffect, useState } from "react";
import {
  api,
  type PlanView,
  type ClaudeUsageSnapshot,
  type ProbeResult,
  type UsageLimitWindow,
  type UsageSummary,
  type AgentUsageEntry,
} from "../api.ts";
import { usePoll } from "../lib/usePoll.ts";
import { Card, Button, Empty, Metric } from "./ui.tsx";
import { ms, usd, tokens, relTime, friendlyProbeError } from "../lib/format.ts";
import { useI18n } from "../lib/useI18n.ts";
import type { TranslationKey } from "../i18n/en.ts";

/** Translate the server-supplied usage-limit label when it matches a known default. */
function limitLabel(label: string, t: (k: TranslationKey) => string): string {
  if (label === "5-hour session") return t("limit_5h");
  if (label === "7-day weekly") return t("limit_7d");
  return label;
}

// ---------------------------------------------------------------------------
// Root view
// ---------------------------------------------------------------------------

export function UsageView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const { data: myhq, error } = usePoll(api.usage, 15000, onAuthError);
  const [plan, setPlan] = useState<PlanView | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [claude, setClaude] = useState<ClaudeUsageSnapshot | null>(null);
  const [agentEntries, setAgentEntries] = useState<AgentUsageEntry[] | null>(null);
  const [probeRunning, setProbeRunning] = useState(false);

  useEffect(() => {
    api.plan().then(setPlan).catch(() => {});
    api.usageProbe().then(setProbe).catch(() => {});
    api.claudeUsage().then(setClaude).catch(() => {});
    api.usageAgents().then((r) => setAgentEntries(r.agents)).catch(() => {});
  }, []);

  if (error) return <Empty>{t("usage_failed_load").replace("{error}", error)}</Empty>;

  const refreshProbe = async () => {
    setProbeRunning(true);
    await api.runProbe().catch(() => {});
    // Poll until fresh result arrives.
    let attempts = 0;
    const poll = setInterval(async () => {
      const p = await api.usageProbe().catch(() => null);
      if (p) setProbe(p);
      if (++attempts >= 15) clearInterval(poll);
    }, 2000);
    setTimeout(() => { clearInterval(poll); setProbeRunning(false); }, 30_000);
  };

  // Derive plan from probe auto-detection when available.
  const detectedPlan =
    probe?.account?.hasMax ? "Claude Max" :
    probe?.account?.hasPro ? "Claude Pro" :
    probe?.account?.subscriptionType ? capFirst(probe.account.subscriptionType) :
    null;

  const isSubscription = Boolean(probe?.account?.hasPro || probe?.account?.hasMax);
  const hasApiCap = !isSubscription && plan && plan.monthlyCap > 0;

  return (
    <div className="space-y-4">
      {/* Live limits — real OAuth data */}
      <LiveLimitsCard
        probe={probe}
        detectedPlan={detectedPlan}
        probeRunning={probeRunning}
        onRefresh={refreshProbe}
      />

      {/* Historical activity from stats-cache */}
      {claude && <ActivityCard claude={claude} />}

      {/* Budget tracker — only for API plan with a cap set */}
      {hasApiCap && plan && (
        <Card title={t("usage_api_budget")}>
          <BudgetBar plan={plan} />
        </Card>
      )}

      {/* Token usage — real input/output tokens per turn, summed. Meaningful on
          every plan (subscription or API), so always shown when we have data. */}
      {myhq && <TokenUsageCard myhq={myhq} />}

      {/* Per-agent breakdown — always rendered so empty state is visible. */}
      <AgentBreakdownCard agents={agentEntries ?? []} />

      {/* MyHQ session metrics — cost is meaningless on a subscription plan, so omit it */}
      {myhq && (
        <>
          {isSubscription ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <Card>
                <Metric
                  label={t("usage_turns_today")}
                  value={myhq.today.turns.toLocaleString()}
                  sub={`${myhq.total.turns.toLocaleString()} ${t("usage_turns_total")}`}
                />
              </Card>
              <Card>
                <Metric label={t("usage_time_today")} value={ms(myhq.today.durationMs)} />
              </Card>
              <Card>
                <Metric label={t("usage_time_lifetime")} value={ms(myhq.total.durationMs)} />
              </Card>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Card>
                  <Metric
                    label={t("usage_cost_today")}
                    value={usd(myhq.today.costUsd)}
                    sub={`${myhq.today.turns} ${myhq.today.turns === 1 ? t("usage_turn") : t("usage_turns")}`}
                  />
                </Card>
                <Card>
                  <Metric
                    label={t("usage_cost_lifetime")}
                    value={usd(myhq.total.costUsd)}
                    sub={`${myhq.total.turns} ${t("usage_turns_total")}`}
                  />
                </Card>
                <Card>
                  <Metric label={t("usage_time_today")} value={ms(myhq.today.durationMs)} />
                </Card>
                <Card>
                  <Metric label={t("usage_time_lifetime")} value={ms(myhq.total.durationMs)} />
                </Card>
              </div>

              <Card title={t("usage_daily_cost")}>
                <CostChart myhq={myhq} plan={plan} isSubscription={isSubscription} />
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live limits card
// ---------------------------------------------------------------------------

function barColor(s: UsageLimitWindow["severity"]): string {
  return s === "critical" ? "bg-red-500" : s === "warning" ? "bg-amber-400" : "bg-accent";
}
function textColor(s: UsageLimitWindow["severity"]): string {
  return s === "critical" ? "text-red-400" : s === "warning" ? "text-amber-400" : "text-emerald-400";
}

function formatMs(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function LimitBar({ lim }: { lim: UsageLimitWindow }) {
  const { t } = useI18n();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const resetsInMs = Math.max(0, new Date(lim.resetsAt).getTime() - Date.now());
  const pct = Math.min(100, lim.percent);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-fg-dim">{limitLabel(lim.label, t)}</span>
        <span className={`text-2xl font-bold tabular ${textColor(lim.severity)}`}>{lim.percent}%</span>
      </div>
      <div className="h-3 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor(lim.severity)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-faint">{lim.severity === "normal" ? t("usage_within_limits") : lim.severity}</span>
        <span className={`font-medium ${resetsInMs < 600_000 ? "text-amber-400" : "text-fg-dim"}`}>
          {t("usage_resets_in").replace("{time}", formatMs(resetsInMs))}
        </span>
      </div>
    </div>
  );
}

function LiveLimitsCard({
  probe,
  detectedPlan,
  probeRunning,
  onRefresh,
}: {
  probe: ProbeResult | null;
  detectedPlan: string | null;
  probeRunning: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const probedAgo = probe?.probedAt
    ? Date.now() - new Date(probe.probedAt).getTime()
    : null;

  return (
    <Card
      title={t("usage_limits_title")}
      right={
        <div className="flex items-center gap-2">
          {detectedPlan && (
            <span className="rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
              {detectedPlan}
            </span>
          )}
          <Button onClick={onRefresh} disabled={probeRunning}>
            {probeRunning ? t("usage_checking") : t("usage_refresh")}
          </Button>
        </div>
      }
    >
      {!probe || probe.source === "none" ? (
        <p className="text-sm text-fg-faint">{t("usage_no_data")}</p>
      ) : probe.source === "fallback" ? (
        <p className="text-sm text-amber-400">
          {friendlyProbeError(probe.error) ?? t("usage_oauth_unavailable")}
        </p>
      ) : probe.limits.length === 0 ? (
        <p className="text-sm text-fg-faint">{t("usage_no_active_limits")}</p>
      ) : (
        <div className="space-y-5">
          {(probe.stale || probe.error) && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
              {friendlyProbeError(probe.error) ?? t("usage_oauth_unavailable")}
            </div>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            {probe.limits.slice(0, 2).map((lim) => (
              <LimitBar key={lim.label} lim={lim} />
            ))}
          </div>
          {probedAgo !== null && (
            <p className="text-xs text-fg-faint">
              {t("usage_updated").replace("{time}", probedAgo < 5000 ? t("usage_just_now") : relTime(new Date(probe.probedAt!).getTime()))}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Historical activity (stats-cache)
// ---------------------------------------------------------------------------

function ActivityCard({ claude }: { claude: ClaudeUsageSnapshot }) {
  const { t } = useI18n();

  return (
    <Card title={t("usage_activity_history")}>
      <div className="space-y-4">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile
            label={claude.hasTodayData ? t("usage_messages_today") : t("usage_messages_last").replace("{date}", claude.lastRecordedDay?.date ?? "last")}
            value={(claude.lastRecordedDay?.messageCount ?? 0).toLocaleString()}
          />
          <Tile
            label={t("usage_messages_this_week")}
            value={claude.weekly.count.toLocaleString()}
          />
          <Tile
            label={t("usage_sessions_last_day")}
            value={(claude.lastRecordedDay?.sessionCount ?? 0).toLocaleString()}
          />
          <Tile
            label={t("usage_tool_calls_last_day")}
            value={(claude.lastRecordedDay?.toolCallCount ?? 0).toLocaleString()}
          />
        </div>

        {/* Lifetime footer */}
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 border-t border-line pt-2 text-xs text-fg-faint">
          <span><span className="text-fg-dim font-medium">{claude.totalMessages.toLocaleString()}</span> {t("usage_total_messages")}</span>
          <span><span className="text-fg-dim font-medium">{claude.totalSessions.toLocaleString()}</span> {t("usage_sessions")}</span>
          {claude.firstSessionDate && (
            <span>{t("usage_since").replace("{date}", new Date(claude.firstSessionDate).toLocaleDateString())}</span>
          )}
          {!claude.hasTodayData && (
            <span className="ml-auto italic">{t("usage_stats_update")}</span>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Budget bar (API plan only)
// ---------------------------------------------------------------------------

function BudgetBar({ plan }: { plan: PlanView }) {
  const { t } = useI18n();
  const pct = Math.min(100, plan.pctUsed);
  const color = plan.pctUsed >= 90 ? "bg-red-500" : plan.pctUsed >= 70 ? "bg-amber-400" : "bg-emerald-400";
  const tcolor = plan.pctUsed >= 90 ? "text-red-400" : plan.pctUsed >= 70 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <span className={`text-2xl font-semibold tabular ${tcolor}`}>${plan.periodCostUsd.toFixed(2)}</span>
        <span className="text-xs text-fg-faint">{t("usage_of_cap").replace("{cap}", String(plan.monthlyCap)).replace("{pct}", plan.pctUsed.toFixed(0))}</span>
        <span className="ml-auto text-xs text-fg-faint">{t("usage_until_reset").replace("{n}", String(plan.daysUntilReset))}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-fg-faint">
        <span>{t("usage_avg_day")}: ${plan.dailyAvgUsd.toFixed(4)}</span>
        <span>{t("usage_est_month")}: ${plan.estimatedMonthlyUsd.toFixed(2)}</span>
        {plan.periodStart && <span>{t("usage_since_label")}: {plan.periodStart}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daily cost chart
// ---------------------------------------------------------------------------

function CostChart({
  myhq,
  plan,
  isSubscription,
}: {
  myhq: { daily: Array<{ day: string; costUsd: number; turns: number }> };
  plan: PlanView | null;
  isSubscription: boolean;
}) {
  const { t } = useI18n();
  const recent = myhq.daily.slice(-30);
  const maxCost = Math.max(0.0001, ...recent.map((d) => d.costUsd));
  const periodStart = plan?.periodStart;

  if (recent.length === 0) return <Empty>{t("usage_no_activity")}</Empty>;

  return (
    <div className="relative flex h-40 items-end gap-1">
      {!isSubscription && plan && plan.monthlyCap > 0 && (() => {
        const dailyCap = plan.monthlyCap / 30;
        const capPct = (dailyCap / maxCost) * 100;
        if (capPct > 100) return null;
        return (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-red-400/40"
            style={{ bottom: `${capPct}%` }}
            title={`Daily cap ceiling: $${dailyCap.toFixed(4)}`}
          />
        );
      })()}
      {recent.map((d) => {
        const inPeriod = periodStart ? d.day >= periodStart : true;
        return (
          <div key={d.day} className="group flex flex-1 flex-col items-center justify-end">
            <div
              className={`w-full rounded-t transition-all ${
                inPeriod ? "bg-accent/70 group-hover:bg-accent" : "bg-fg-faint/20 group-hover:bg-fg-faint/40"
              }`}
              style={{ height: `${(d.costUsd / maxCost) * 100}%` }}
              title={`${d.day}: ${usd(d.costUsd)} · ${d.turns} ${t("usage_turns")}`}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-agent token breakdown
// ---------------------------------------------------------------------------

const ROLE_LABEL: Record<string, string> = {
  atlas: "Atlas",
  lead: "Lead",
  worker: "Worker",
  task: "Task",
};

function AgentBreakdownCard({ agents }: { agents: AgentUsageEntry[] }) {
  const { t } = useI18n();
  if (agents.length === 0)
    return (
      <Card title={t("usage_agents_title")}>
        <p className="text-sm text-fg-faint">{t("usage_agents_no_data")}</p>
      </Card>
    );

  return (
    <Card title={t("usage_agents_title")}>
      <div className="overflow-x-auto">
        <div className="min-w-[480px]">
          {/* Header row */}
          <div className="mb-1 grid grid-cols-[1fr_80px_80px_72px_52px] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-fg-dim">
            <span>{t("usage_agents_col_agent")}</span>
            <span className="text-right">{t("usage_agents_col_input")}</span>
            <span className="text-right">{t("usage_agents_col_output")}</span>
            <span className="text-right">{t("usage_agents_col_cost")}</span>
            <span className="text-right">{t("usage_agents_col_turns")}</span>
          </div>
          {/* Data rows */}
          {agents.map((a) => (
            <div
              key={a.name}
              className="grid grid-cols-[1fr_80px_80px_72px_52px] gap-2 rounded px-1 py-1 text-sm even:bg-bg-surface/40"
            >
              <span className="flex items-center gap-1.5 font-medium text-fg truncate">
                {a.name}
                <span className="shrink-0 rounded bg-accent/10 px-1 py-0.5 text-[10px] font-semibold text-accent">
                  {ROLE_LABEL[a.role] ?? a.role}
                </span>
              </span>
              <span className="text-right font-mono text-fg-dim">{tokens(a.total.inputTokens)}</span>
              <span className="text-right font-mono text-fg-dim">{tokens(a.total.outputTokens)}</span>
              <span className="text-right font-mono text-fg-dim">
                {a.total.costUsd > 0 ? usd(a.total.costUsd) : "—"}
              </span>
              <span className="text-right font-mono text-fg-dim">{a.total.turns}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Token usage (real input/output tokens per turn, summed)
// ---------------------------------------------------------------------------

function TokenUsageCard({ myhq }: { myhq: UsageSummary }) {
  const { t } = useI18n();
  const hasTokens =
    myhq.total.inputTokens > 0 ||
    myhq.total.outputTokens > 0 ||
    myhq.total.cacheReadTokens > 0 ||
    myhq.total.cacheWriteTokens > 0;

  return (
    <Card title={t("usage_tokens_title")}>
      {!hasTokens ? (
        <p className="text-sm text-fg-faint">{t("usage_tokens_no_data")}</p>
      ) : (
        <div className="space-y-4">
          {/* Today vs lifetime input/output/cache breakdown */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile
              label={`${t("usage_tokens_input")} · ${t("usage_tokens_today")}`}
              value={tokens(myhq.today.inputTokens)}
            />
            <Tile
              label={`${t("usage_tokens_output")} · ${t("usage_tokens_today")}`}
              value={tokens(myhq.today.outputTokens)}
            />
            <Tile
              label={`${t("usage_tokens_input")} · ${t("usage_tokens_lifetime")}`}
              value={tokens(myhq.total.inputTokens)}
            />
            <Tile
              label={`${t("usage_tokens_output")} · ${t("usage_tokens_lifetime")}`}
              value={tokens(myhq.total.outputTokens)}
            />
          </div>

          {/* Cache footer — useful to see how much is served from cache */}
          <div className="flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-fg-faint">
            <span>
              <span className="font-medium text-fg-dim">{tokens(myhq.total.cacheReadTokens)}</span>{" "}
              {t("usage_tokens_cache_read")}
            </span>
            <span>
              <span className="font-medium text-fg-dim">{tokens(myhq.total.cacheWriteTokens)}</span>{" "}
              {t("usage_tokens_cache_write")}
            </span>
          </div>

          {/* Daily input vs output chart */}
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-fg-dim">
                {t("usage_tokens_per_day")}
              </p>
              <div className="flex items-center gap-3 text-xs text-fg-faint">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-accent/70" />
                  {t("usage_tokens_legend_input")}
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-sm bg-emerald-400/70" />
                  {t("usage_tokens_legend_output")}
                </span>
              </div>
            </div>
            <TokenChart myhq={myhq} />
            <p className="text-xs text-fg-faint">{t("usage_tokens_in_out")}</p>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Stacked daily bar chart of input (bottom) + output (top) tokens per day. */
function TokenChart({ myhq }: { myhq: UsageSummary }) {
  const { t } = useI18n();
  const recent = myhq.daily.slice(-30);
  const max = Math.max(1, ...recent.map((d) => d.inputTokens + d.outputTokens));

  if (recent.length === 0) return <Empty>{t("usage_no_activity")}</Empty>;

  return (
    <div className="relative flex h-40 items-end gap-1">
      {recent.map((d) => {
        const total = d.inputTokens + d.outputTokens;
        const totalPct = (total / max) * 100;
        // Within the bar, split the height between input and output.
        const inPct = total > 0 ? (d.inputTokens / total) * 100 : 0;
        const outPct = total > 0 ? (d.outputTokens / total) * 100 : 0;
        return (
          <div key={d.day} className="group flex flex-1 flex-col items-center justify-end">
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-t"
              style={{ height: `${totalPct}%` }}
              title={`${d.day}: ${tokens(d.inputTokens)} ${t("usage_tokens_legend_input")} · ${tokens(d.outputTokens)} ${t("usage_tokens_legend_output")}`}
            >
              <div
                className="w-full bg-emerald-400/70 transition-all group-hover:bg-emerald-400"
                style={{ height: `${outPct}%` }}
              />
              <div
                className="w-full bg-accent/70 transition-all group-hover:bg-accent"
                style={{ height: `${inPct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-input p-3">
      <p className="text-[10px] uppercase tracking-wide text-fg-faint">{label}</p>
      <p className="mt-1 text-xl font-bold tabular text-fg">{value}</p>
    </div>
  );
}

function capFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
