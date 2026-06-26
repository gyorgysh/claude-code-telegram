import { useEffect, useState } from "react";
import {
  api,
  AuthError,
  type SecretView,
  type TunnelProviderId,
  type TunnelView,
} from "../api.ts";
import { Badge, Button, Callout, Card, Empty, Input, Label, Select } from "./ui.tsx";
import { relTime } from "../lib/format.ts";
import { useI18n } from "../lib/useI18n.ts";
import type { TranslationKey } from "../i18n/en.ts";

const PROVIDERS: Array<{ id: TunnelProviderId; label: TranslationKey; desc: TranslationKey }> = [
  { id: "ngrok", label: "ra_provider_ngrok", desc: "ra_provider_ngrok_desc" },
  { id: "cloudflare", label: "ra_provider_cloudflare", desc: "ra_provider_cloudflare_desc" },
];

export function RemoteAccessView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [view, setView] = useState<TunnelView | null>(null);
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Draft form state (provider/token/domain) editable before saving.
  const [provider, setProvider] = useState<TunnelProviderId>("ngrok");
  const [token, setToken] = useState("");
  const [domain, setDomain] = useState("");

  const fail = (e: unknown) => (e instanceof AuthError ? onAuthError() : setError(String(e)));

  const load = () =>
    api
      .tunnel()
      .then((v) => {
        setView(v);
        setProvider(v.provider);
        setDomain(v.domain);
      })
      .catch(fail);

  useEffect(() => {
    void load();
    api.vault().then((r) => setSecrets(r.secrets)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the relay is coming up or running, poll so the public URL appears.
  useEffect(() => {
    if (!view) return;
    if (view.state !== "starting" && view.state !== "running") return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.state]);

  const saveConfig = async () => {
    setError(null);
    setBusy(true);
    try {
      // Blank token = keep the saved one. A `vault:<id>` reference or plaintext
      // both flow straight through to the manager.
      const v = await api.saveTunnel({ provider, authToken: token.trim() || undefined, domain });
      setView(v);
      setToken("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      // Persist the current form first, then launch.
      await api.saveTunnel({ provider, authToken: token.trim() || undefined, domain });
      setToken("");
      setView(await api.startTunnel());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setError(null);
    setBusy(true);
    try {
      setView(await api.stopTunnel());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <Card title={t("ra_title")}>
        {error ? <p className="text-sm text-red-400">{error}</p> : <Empty>{t("loading")}</Empty>}
      </Card>
    );
  }

  // Feature gated off in the env — show a locked explainer, no controls.
  if (!view.enabled) {
    return (
      <div className="space-y-4">
        <Callout title={t("ra_disabled_title")}>{t("ra_disabled_body")}</Callout>
        <Card title={t("ra_title")}>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-2xl">
              🔒
            </div>
            <div className="text-sm font-medium text-fg">{t("ra_disabled_overlay")}</div>
            <div className="max-w-sm text-xs text-fg-faint">{t("ra_disabled_hint")}</div>
          </div>
        </Card>
      </div>
    );
  }

  const running = view.state === "running";
  const starting = view.state === "starting";
  const live = running || starting;

  return (
    <div className="space-y-4">
      <Callout title={t("ra_security_title")} dismissId="remote-access-security">
        {t("ra_security_body")}
      </Callout>

      <Card
        title={t("ra_title")}
        right={<StateBadge state={view.state} t={t} />}
      >
        <p className="mb-3 text-sm text-fg-dim">{t("ra_desc")}</p>
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}

        {/* Public URL panel (when up) */}
        {running && view.url && (
          <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-dim">
              {t("ra_public_url")}
            </div>
            <a
              href={view.url}
              target="_blank"
              rel="noreferrer"
              className="mono break-all text-sm text-accent hover:underline"
            >
              {view.url}
            </a>
            {view.startedAt && (
              <div className="mt-1 text-xs text-fg-faint">
                {t("ra_started").replace("{time}", relTime(view.startedAt))}
              </div>
            )}
          </div>
        )}
        {starting && (
          <div className="mb-4 rounded-lg border border-line bg-surface-2 p-3 text-sm text-fg-dim">
            {t("ra_starting")}
          </div>
        )}
        {view.state === "error" && view.error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-400">
            {view.error}
          </div>
        )}

        {/* Provider picker */}
        <Label>{t("ra_provider")}</Label>
        <div className="mb-4 grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              disabled={live}
              onClick={() => setProvider(p.id)}
              className={`rounded-lg border p-2.5 text-left text-sm transition-colors disabled:opacity-50 ${
                provider === p.id
                  ? "border-accent bg-accent/10 text-fg"
                  : "border-line text-fg-dim hover:bg-surface-2"
              }`}
            >
              <div className="font-medium">{t(p.label)}</div>
              <div className="text-xs text-fg-faint">{t(p.desc)}</div>
            </button>
          ))}
        </div>

        {/* Auth token */}
        <div className="mb-3">
          <Label>
            {provider === "ngrok" ? t("ra_token_required") : t("ra_token_optional")}
          </Label>
          {secrets.length > 0 && (
            <Select
              className="mb-2"
              value=""
              disabled={live}
              onChange={(e) => e.target.value && setToken(e.target.value)}
            >
              <option value="">{t("ra_token_pick_vault")}</option>
              {secrets.map((s) => (
                <option key={s.id} value={`vault:${s.id}`}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
          <Input
            type="password"
            disabled={live}
            placeholder={view.hasToken ? t("ra_token_saved") : t("ra_token_placeholder")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="mt-1 text-xs text-fg-faint">{t("ra_token_hint")}</p>
        </div>

        {/* Optional reserved domain */}
        <div className="mb-4">
          <Label>{t("ra_domain")}</Label>
          <Input
            disabled={live}
            placeholder={t("ra_domain_placeholder")}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <p className="mt-1 text-xs text-fg-faint">{t("ra_domain_hint")}</p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <Button variant="danger" onClick={stop} disabled={busy}>
              {t("ra_stop")}
            </Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={busy}>
              {t("ra_start")}
            </Button>
          )}
          <Button onClick={saveConfig} disabled={busy || live}>
            {t("ra_save")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StateBadge({ state, t }: { state: TunnelView["state"]; t: (k: TranslationKey) => string }) {
  const map: Record<TunnelView["state"], { tone: "zinc" | "green" | "amber"; key: TranslationKey }> = {
    stopped: { tone: "zinc", key: "ra_state_stopped" },
    starting: { tone: "amber", key: "ra_state_starting" },
    running: { tone: "green", key: "ra_state_running" },
    error: { tone: "amber", key: "ra_state_error" },
  };
  const m = map[state];
  return <Badge tone={m.tone}>{t(m.key)}</Badge>;
}
