import { useEffect, useState } from "react";
import {
  api,
  AuthError,
  type SecretView,
  type WebhookParam,
  type WebhookParamIn,
  type WebhookTool,
} from "../api.ts";
import { Badge, Button, Card, Input, Label, Select, TextArea } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const PARAM_INS: WebhookParamIn[] = ["query", "header", "body", "path"];

type Draft = {
  name: string;
  description: string;
  method: WebhookTool["method"];
  url: string;
  params: WebhookParam[];
  authSecretId: string;
  authHeader: string;
};

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  method: "GET",
  url: "",
  params: [],
  authSecretId: "",
  authHeader: "Authorization",
});

/** Custom outbound HTTP endpoints the agent can call as MCP tools. */
export function WebhookToolsView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [tools, setTools] = useState<WebhookTool[]>([]);
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  const load = () =>
    Promise.all([api.webhookTools(), api.vault()])
      .then(([w, v]) => {
        setTools(w.tools);
        setSecrets(v.secrets);
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setDraft(emptyDraft());
    setEditing("new");
  };

  const startEdit = (tool: WebhookTool) => {
    // A header value of `vault:<id>` becomes the auth dropdown; everything else
    // is ignored in this simplified editor (covers the common bearer-token case).
    let authSecretId = "";
    let authHeader = "Authorization";
    for (const [k, v] of Object.entries(tool.headers)) {
      if (typeof v === "string" && v.startsWith("vault:")) {
        authSecretId = v.slice("vault:".length);
        authHeader = k;
        break;
      }
    }
    setDraft({
      name: tool.name,
      description: tool.description,
      method: tool.method,
      url: tool.url,
      params: tool.params.map((p) => ({ ...p })),
      authSecretId,
      authHeader,
    });
    setEditing(tool.id);
  };

  const cancel = () => {
    setEditing(null);
    setDraft(emptyDraft());
  };

  const save = async () => {
    const headers: Record<string, string> = {};
    if (draft.authSecretId) headers[draft.authHeader || "Authorization"] = `vault:${draft.authSecretId}`;
    const body = {
      name: draft.name,
      description: draft.description,
      method: draft.method,
      url: draft.url,
      params: draft.params,
      headers,
    };
    try {
      if (editing === "new") await api.createWebhookTool(body);
      else if (editing) await api.updateWebhookTool(editing, body);
      cancel();
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const toggle = async (tool: WebhookTool) => {
    setTools((ts) => ts.map((x) => (x.id === tool.id ? { ...x, enabled: !x.enabled } : x)));
    await api.updateWebhookTool(tool.id, { enabled: !tool.enabled }).catch(() => void load());
  };

  const remove = async (id: string) => {
    setTools((ts) => ts.filter((x) => x.id !== id));
    await api.deleteWebhookTool(id).catch(() => void load());
  };

  const addParam = () =>
    setDraft((d) => ({ ...d, params: [...d.params, { name: "", in: "query", required: false }] }));
  const updateParam = (i: number, patch: Partial<WebhookParam>) =>
    setDraft((d) => ({ ...d, params: d.params.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const removeParam = (i: number) =>
    setDraft((d) => ({ ...d, params: d.params.filter((_, j) => j !== i) }));

  return (
    <Card title={t("webhooks_title")}>
      <p className="mb-3 text-sm text-fg-dim">{t("webhooks_desc")}</p>
      {error && <p className="mb-2 text-sm text-critical-fg">{error}</p>}

      {editing ? (
        <div className="rounded-lg border border-line p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("webhooks_name")}</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("webhooks_name_ph")} />
            </div>
            <div>
              <Label>{t("webhooks_method")}</Label>
              <Select value={draft.method} onChange={(e) => setDraft({ ...draft, method: e.target.value as WebhookTool["method"] })}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="mt-3">
            <Label>{t("webhooks_url")}</Label>
            <Input value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder="https://api.example.com/v1/{id}" />
            <p className="mt-1 text-xs text-fg-faint">{t("webhooks_url_hint")}</p>
          </div>
          <div className="mt-3">
            <Label>{t("webhooks_description")}</Label>
            <TextArea rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder={t("webhooks_description_ph")} />
            <p className="mt-1 text-xs text-fg-faint">{t("webhooks_description_hint")}</p>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <Label>{t("webhooks_params")}</Label>
              <Button onClick={addParam}>{t("webhooks_add_param")}</Button>
            </div>
            {draft.params.length === 0 && <p className="text-xs text-fg-faint">{t("webhooks_no_params")}</p>}
            <div className="mt-1 space-y-2">
              {draft.params.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Input className="w-32" value={p.name} onChange={(e) => updateParam(i, { name: e.target.value })} placeholder={t("webhooks_param_name")} />
                  <Select wrapperClassName="w-28" value={p.in} onChange={(e) => updateParam(i, { in: e.target.value as WebhookParamIn })}>
                    {PARAM_INS.map((pi) => (
                      <option key={pi} value={pi}>{pi}</option>
                    ))}
                  </Select>
                  <Input className="flex-1 min-w-[8rem]" value={p.description ?? ""} onChange={(e) => updateParam(i, { description: e.target.value })} placeholder={t("webhooks_param_desc")} />
                  <label className="flex items-center gap-1 text-xs text-fg-dim">
                    <input type="checkbox" checked={p.required ?? false} onChange={(e) => updateParam(i, { required: e.target.checked })} />
                    {t("webhooks_param_required")}
                  </label>
                  <Button onClick={() => removeParam(i)}>{t("remove")}</Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("webhooks_auth_secret")}</Label>
              <Select value={draft.authSecretId} onChange={(e) => setDraft({ ...draft, authSecretId: e.target.value })}>
                <option value="">{t("none")}</option>
                {secrets.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-fg-faint">{t("webhooks_auth_hint")}</p>
            </div>
            {draft.authSecretId && (
              <div>
                <Label>{t("webhooks_auth_header")}</Label>
                <Input value={draft.authHeader} onChange={(e) => setDraft({ ...draft, authHeader: e.target.value })} placeholder="Authorization" />
              </div>
            )}
          </div>

          <div className="mt-3 flex gap-2">
            <Button variant="primary" onClick={save} disabled={!draft.name.trim() || !draft.url.trim()}>
              {t("save")}
            </Button>
            <Button onClick={cancel}>{t("cancel")}</Button>
          </div>
        </div>
      ) : (
        <>
          {tools.length === 0 ? (
            <p className="text-sm text-fg-faint">{t("webhooks_empty")}</p>
          ) : (
            <div className="space-y-2">
              {tools.map((tool) => (
                <div key={tool.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-fg">{tool.name}</span>
                        <Badge tone="zinc">{tool.method}</Badge>
                        {tool.enabled ? <Badge tone="green">{t("webhooks_on")}</Badge> : <Badge tone="zinc">{t("webhooks_off")}</Badge>}
                      </div>
                      <p className="mt-1 truncate text-xs text-fg-faint">{tool.url}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button onClick={() => toggle(tool)}>{tool.enabled ? t("webhooks_disable") : t("webhooks_enable")}</Button>
                      <Button onClick={() => startEdit(tool)}>{t("edit")}</Button>
                      <Button onClick={() => remove(tool.id)}>{t("remove")}</Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button variant="primary" onClick={startNew}>{t("webhooks_add")}</Button>
          </div>
        </>
      )}
    </Card>
  );
}
