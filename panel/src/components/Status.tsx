import { api, type BackendStatus, type ServiceStatus } from "../api.ts";
import { usePoll } from "../lib/usePoll.ts";
import { Badge, Card, Empty } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";
import type { TranslationKey } from "../i18n/en.ts";

const KIND_LABEL: Record<BackendStatus["kind"], TranslationKey> = {
  anthropic: "status_kind_anthropic",
  provider: "status_kind_provider",
  local: "status_kind_local",
};

export function StatusView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const { data, error } = usePoll(() => api.status(), 15_000, onAuthError);

  return (
    <div className="space-y-4">
      {data && <ServiceBanner s={data.service} />}
      <Card title={t("status_backends_title")}>
        <p className="mb-3 text-sm text-fg-dim">{t("status_backends_desc")}</p>
        {error && <p className="mb-2 text-sm text-critical-fg">{error}</p>}
        {!data ? (
          <Empty>{t("checking")}</Empty>
        ) : data.backends.length === 0 ? (
          <Empty>{t("status_no_backends")}</Empty>
        ) : (
          <div className="space-y-2">
            {data.backends.map((b) => (
              <BackendRow key={b.id} b={b} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ServiceBanner({ s }: { s: ServiceStatus }) {
  const { t } = useI18n();
  const ok = s.indicator === "none";
  const bad = s.indicator === "major" || s.indicator === "critical";
  const dot = ok ? "bg-ok" : s.indicator === "minor" ? "bg-warn" : bad ? "bg-critical" : "bg-fg-faint";
  return (
    <Card title={t("status_service_title")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="text-sm text-fg">
            {s.error ? t("status_unreachable") : s.description || t("status_unknown")}
          </span>
        </div>
        <a
          href={s.url}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-fg-dim hover:text-fg-muted"
        >
          status.claude.com ↗
        </a>
      </div>
      <p className="mt-1 text-xs text-fg-faint">
        {t("status_public_note")}
      </p>
    </Card>
  );
}

function BackendRow({ b }: { b: BackendStatus }) {
  const { t } = useI18n();
  const state = !b.reachable ? "down" : !b.authOk ? "auth" : "up";
  const dot =
    state === "up" ? "bg-ok" : state === "auth" ? "bg-warn" : "bg-critical";
  const label = state === "up" ? t("status_up") : state === "auth" ? t("status_auth") : t("status_down");

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
            <span className="font-medium text-fg">{b.name}</span>
            <Badge>{t(KIND_LABEL[b.kind])}</Badge>
          </div>
          <div className="mono mt-1 truncate text-xs text-fg-faint" title={b.baseUrl}>
            {b.baseUrl}
          </div>
          {b.error && <p className="mt-1 text-xs text-critical-fg">{b.error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-xs text-fg-dim">
          <span className="tabular">{t("status_models").replace("{n}", String(b.models.length))}</span>
          <span className={`rounded px-1.5 py-0.5 font-medium ${
            state === "up"
              ? "bg-ok-subtle text-ok-fg"
              : state === "auth"
                ? "bg-warn-subtle text-warn-fg"
                : "bg-critical-subtle text-critical-fg"
          }`}>
            {label}
          </span>
        </div>
      </div>
      {b.models.length > 0 && (
        <div className="mono mt-2 flex flex-wrap gap-1.5">
          {b.models.map((m) => (
            <span key={m} className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
              {m}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
