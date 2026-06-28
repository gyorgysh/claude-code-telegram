import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useI18n } from "../lib/useI18n.ts";
import { InfoCard } from "./ui.tsx";
import type { TranslationKey } from "../i18n/en.ts";
import type { Tab } from "./Sidebar.tsx";

// ---------------------------------------------------------------------------
// Empty-state illustrations
//
// A small set of line-art SVGs sharing one visual language: 1.5px strokes in
// `currentColor` so they inherit the muted theme token from the <Empty> wrapper
// and adapt to light / dark / matrix automatically. No fills, no hardcoded
// colours.
// ---------------------------------------------------------------------------

const svgProps = {
  width: 72,
  height: 72,
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Crew / workers — a head with two reports below it. */
export function CrewArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <circle cx="24" cy="11" r="5" />
      <circle cx="13" cy="33" r="4.5" />
      <circle cx="35" cy="33" r="4.5" />
      <path d="M24 16v6m0 0l-9 7m9-7l9 7" />
    </svg>
  );
}

/** Schedules — a clock face. */
export function ScheduleArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <circle cx="24" cy="24" r="16" />
      <path d="M24 15v9l6 4" />
    </svg>
  );
}

/** Inbox — an open tray with an envelope. */
export function InboxArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <path d="M8 28v8a2 2 0 002 2h28a2 2 0 002-2v-8" />
      <path d="M8 28l5-16a2 2 0 012-1.5h18a2 2 0 012 1.5l5 16" />
      <path d="M8 28h9l2 4h10l2-4h9" />
    </svg>
  );
}

/** Skills — a spark / asterisk in a rounded square. */
export function SkillsArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <rect x="9" y="9" width="30" height="30" rx="4" />
      <path d="M24 16v16M16 24h16M18.5 18.5l11 11M29.5 18.5l-11 11" />
    </svg>
  );
}

/** Memory — overlapping notes / cards. */
export function MemoryArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <rect x="9" y="13" width="22" height="26" rx="2" />
      <path d="M17 9h22v26" />
      <path d="M13.5 20h13M13.5 25h13M13.5 30h8" />
    </svg>
  );
}

/** Vault — a padlock. */
export function VaultArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <rect x="11" y="21" width="26" height="18" rx="3" />
      <path d="M16 21v-5a8 8 0 0116 0v5" />
      <circle cx="24" cy="29" r="2" />
      <path d="M24 31v3" />
    </svg>
  );
}

/** Sessions — a chat bubble. */
export function SessionsArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <path d="M9 12a3 3 0 013-3h24a3 3 0 013 3v16a3 3 0 01-3 3H20l-8 7v-7h-0a3 3 0 01-3-3z" />
      <path d="M16 17h16M16 22h10" />
    </svg>
  );
}

/** Tasks — a kanban board with three columns. */
export function TasksArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <rect x="8" y="10" width="9" height="28" rx="2" />
      <rect x="20" y="10" width="9" height="20" rx="2" />
      <rect x="32" y="10" width="9" height="24" rx="2" />
    </svg>
  );
}

/** Logs — stacked log lines. */
export function LogsArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <rect x="9" y="11" width="30" height="26" rx="3" />
      <path d="M14 18h6M24 18h10M14 24h12M14 30h8" />
    </svg>
  );
}

/** Heartbeat — a steady pulse line, "all clear". */
export function HeartbeatArt() {
  return (
    <svg {...svgProps} aria-hidden>
      <path d="M6 24h7l4-9 6 18 4-12 3 5h12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// "How it all connects" visual map
//
// A code-light, theme-aware diagram that orients a brand-new user: it shows the
// path a message takes (You → Atlas → a tool → the result), and how the three
// concepts that otherwise feel disconnected — Leads, Skills, Memory — plug into
// Atlas. Built from flexbox boxes + tiny SVG connectors (no <text>, so every
// label is translatable), it lives inside a collapsible InfoCard so it doubles
// as a persistent "?" help panel after onboarding is dismissed.
// ---------------------------------------------------------------------------

/** A single labelled node in the flow map. */
function FlowNode({
  label,
  sub,
  variant = "plain",
}: {
  label: string;
  sub?: string;
  variant?: "plain" | "accent";
}) {
  const accent = variant === "accent";
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-lg border px-3 py-2 text-center ${
        accent ? "border-accent/40 bg-accent/10" : "border-line bg-surface-2"
      }`}
    >
      <span className={`text-xs font-semibold ${accent ? "text-accent" : "text-fg"}`}>{label}</span>
      {sub && <span className="mt-0.5 text-[10px] leading-tight text-fg-faint">{sub}</span>}
    </div>
  );
}

/** A horizontal arrow connector between two nodes in the main flow. */
function FlowArrow() {
  return (
    <svg
      width="22"
      height="12"
      viewBox="0 0 22 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-fg-faint"
      aria-hidden
    >
      <path d="M2 6h17M14 1l5 5-5 5" />
    </svg>
  );
}

/** The orient-yourself flow map, rendered inside a collapsible InfoCard. */
export function HowItConnects() {
  const { t } = useI18n();
  return (
    <InfoCard id="how-it-connects" title={t("how_show")} openTitle={t("how_title")}>
      <p>{t("how_intro")}</p>

      {/* Main flow: You → Atlas → Tool → Result */}
      <div className="my-1 flex items-stretch justify-center gap-1.5 sm:gap-2">
        <FlowNode label={t("how_you")} sub={t("how_you_sub")} />
        <div className="flex items-center">
          <FlowArrow />
        </div>
        <FlowNode label={t("how_atlas")} sub={t("how_atlas_sub")} variant="accent" />
        <div className="flex items-center">
          <FlowArrow />
        </div>
        <FlowNode label={t("how_tool")} sub={t("how_tool_sub")} />
        <div className="flex items-center">
          <FlowArrow />
        </div>
        <FlowNode label={t("how_result")} sub={t("how_result_sub")} />
      </div>

      {/* Connector line down from Atlas to its plug-ins */}
      <div className="flex justify-center">
        <svg
          width="2"
          height="16"
          viewBox="0 0 2 16"
          className="text-line"
          aria-hidden
        >
          <path d="M1 0v16" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 3" />
        </svg>
      </div>

      {/* Plug-ins that feed Atlas: Leads, Skills, Memory */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        <FlowNode label={t("how_leads")} sub={t("how_leads_sub")} />
        <FlowNode label={t("how_skills")} sub={t("how_skills_sub")} />
        <FlowNode label={t("how_memory")} sub={t("how_memory_sub")} />
      </div>

      <p className="text-fg-faint">{t("how_outro")}</p>
    </InfoCard>
  );
}

// ---------------------------------------------------------------------------
// First-run "Getting started" checklist
//
// Shows on the dashboard until every step is done OR the card is dismissed.
// Each step links to the tab where the action lives. Steps reflect real state
// (a worker exists, a schedule exists, a secret is vaulted, a connector is
// attached) so the checklist self-completes as the user sets things up.
// ---------------------------------------------------------------------------

type Step = {
  key: TranslationKey;
  descKey: TranslationKey;
  tab: Tab;
  done: boolean;
};

const DISMISS_KEY = "cct.onboarding.dismissed";

export function GettingStarted({ onGoto }: { onGoto: (t: Tab) => void }) {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const [steps, setSteps] = useState<Step[] | null>(null);

  useEffect(() => {
    if (dismissed) return;
    let alive = true;
    Promise.allSettled([api.workers(), api.schedules(), api.vault(), api.connectors()]).then(
      ([w, s, v, c]) => {
        if (!alive) return;
        const hasWorker = w.status === "fulfilled" && w.value.workers.length > 0;
        const hasSchedule = s.status === "fulfilled" && s.value.schedules.length > 0;
        const hasSecret = v.status === "fulfilled" && v.value.secrets.length > 0;
        const hasConnector =
          c.status === "fulfilled" && c.value.connectors.some((x) => Boolean(x.secretId));
        setSteps([
          { key: "onb_step_crew", descKey: "onb_step_crew_desc", tab: "crew", done: hasWorker },
          { key: "onb_step_schedule", descKey: "onb_step_schedule_desc", tab: "schedules", done: hasSchedule },
          { key: "onb_step_vault", descKey: "onb_step_vault_desc", tab: "vault", done: hasSecret },
          { key: "onb_step_connect", descKey: "onb_step_connect_desc", tab: "connectors", done: hasConnector },
        ]);
      },
    );
    return () => {
      alive = false;
    };
  }, [dismissed]);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  if (dismissed || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  // Self-dismiss once everything is set up — no clutter for configured installs.
  if (doneCount === steps.length) return null;

  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-fg">{t("onb_title")}</h3>
          <p className="mt-0.5 text-xs text-fg-dim">{t("onb_desc")}</p>
        </div>
        <button
          onClick={dismiss}
          className="shrink-0 text-xs text-fg-faint hover:text-fg-muted"
          aria-label={t("onb_dismiss")}
        >
          {t("onb_dismiss")}
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="tabular shrink-0 text-xs text-fg-dim">
          {doneCount}/{steps.length}
        </span>
      </div>

      <ul className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.key}>
            <button
              onClick={() => onGoto(s.tab)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                  s.done
                    ? "border-accent bg-accent text-accent-fg"
                    : "border-line text-transparent"
                }`}
              >
                ✓
              </span>
              <span className="min-w-0 flex-1">
                <span className={`text-sm ${s.done ? "text-fg-dim line-through" : "text-fg"}`}>
                  {t(s.key)}
                </span>
                {!s.done && (
                  <span className="block truncate text-xs text-fg-faint">{t(s.descKey)}</span>
                )}
              </span>
              {!s.done && <span className="shrink-0 text-xs text-accent">→</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
