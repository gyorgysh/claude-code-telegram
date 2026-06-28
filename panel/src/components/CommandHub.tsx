import { useI18n } from "../lib/useI18n.ts";
import type { Tab } from "./Sidebar.tsx";
import { ChatView } from "./Chat.tsx";
import { TerminalView } from "./Terminal.tsx";

/**
 * Command Hub — the unified "Operate" surface. A single top-level tab that
 * hosts Chat and Terminal as sub-tabs, replacing two separate sidebar entries.
 *
 * The active sub-tab is derived from the route: /chat and /terminal map to
 * their sub-views directly (legacy deep-links keep working), while the bare
 * /command route lands on the first available sub-tab. Switching a sub-tab
 * pushes the matching URL so refresh/back behaves naturally.
 */
type SubTab = "chat" | "terminal";

export function CommandHub({
  tab,
  onSubTab,
  chatEnabled,
  terminalEnabled,
  onAuthError,
}: {
  tab: Tab | "settings";
  onSubTab: (t: SubTab) => void;
  chatEnabled: boolean;
  terminalEnabled: boolean;
  onAuthError: () => void;
}) {
  const { t } = useI18n();

  const subTabs: Array<{ id: SubTab; labelKey: "command_tab_chat" | "command_tab_terminal"; icon: string; enabled: boolean }> = [
    { id: "chat", labelKey: "command_tab_chat", icon: "❯", enabled: chatEnabled },
    { id: "terminal", labelKey: "command_tab_terminal", icon: "▸", enabled: terminalEnabled },
  ];
  const available = subTabs.filter((s) => s.enabled);

  // Resolve the active sub-tab from the route, falling back to the first
  // available one (Chat normally; Terminal if chat is disabled).
  const fallback: SubTab = available[0]?.id ?? "chat";
  const active: SubTab = tab === "terminal" ? "terminal" : tab === "chat" ? "chat" : fallback;

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tab bar */}
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {subTabs.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={isActive}
              disabled={!s.enabled}
              onClick={() => onSubTab(s.id)}
              className={`relative flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                isActive
                  ? "text-accent"
                  : "text-fg-dim hover:text-fg"
              }`}
            >
              <span aria-hidden>{s.icon}</span>
              <span>{t(s.labelKey)}</span>
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />
              )}
            </button>
          );
        })}
      </div>

      {/* Active sub-view */}
      <div className="min-h-0 flex-1">
        {active === "chat" ? (
          chatEnabled ? (
            <ChatView onAuthError={onAuthError} />
          ) : (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-faint">
              {t("nav_chat_hint")}
            </p>
          )
        ) : terminalEnabled ? (
          <TerminalView onAuthError={onAuthError} />
        ) : (
          <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-faint">
            {t("command_terminal_disabled")}
          </p>
        )}
      </div>
    </div>
  );
}
