import { useEffect, useId, useRef, useState } from "react";
import { api, AuthError, type Worker, type WorkerRun, type Autonomy } from "../api.ts";
import { useWorkerEvents, type LiveRun } from "../lib/useWorkerEvents.ts";
import { useI18n } from "../lib/useI18n.ts";
import type { TranslationKey } from "../i18n/en.ts";
import { Badge, Button, Card, Empty, Input, Label, Select, TextArea } from "./ui.tsx";
import { ms, relTime, usd } from "../lib/format.ts";
import { AGENT_LANGUAGES } from "../i18n/languages.ts";

const emptyForm = {
  name: "",
  cwd: "",
  prompt: "",
  model: "",
  providerId: "",
  systemPrompt: "",
  skillId: "",
  when: "",
  role: "" as "" | "lead" | "assistant",
  portfolio: "",
  parentId: "",
  telegramToken: "",
  persona: "",
  autonomy: "full" as Autonomy,
  language: "",
};
type Form = typeof emptyForm;

type Named = { id: string; name: string };

/** Short, readable label for a model id badge (e.g. "haiku-4-5"). */
function shortModel(id: string): string {
  return id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

// Suggested Anthropic model ids (free-text, so local model names work too).
const MODEL_SUGGESTIONS = [
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
];

const PERSONA_PRESETS: Array<{ labelKey: TranslationKey; value: string }> = [
  { labelKey: "settings_persona_concise", value: "Concise and direct. Lead with the result, skip preamble, use short sentences." },
  { labelKey: "settings_persona_warm", value: "Warm and encouraging. Acknowledge effort, celebrate wins, frame challenges positively." },
  { labelKey: "settings_persona_formal", value: "Formal and precise. Use structured language, avoid contractions and casual expressions." },
  { labelKey: "settings_persona_analytical", value: "Analytical and methodical. Think through problems step by step, cite specifics." },
  { labelKey: "settings_persona_playful", value: "Witty and playful. Use light humor, analogies, and keep the energy high." },
];

const AUTONOMY_KEY: Record<Autonomy, TranslationKey> = {
  supervised: "supervised",
  standard: "standard",
  full: "full",
};

export function WorkersView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [skills, setSkills] = useState<Named[]>([]);
  const [providers, setProviders] = useState<Named[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useWorkerEvents();

  const load = () =>
    api
      .workers()
      .then((r) => {
        setWorkers(r.workers);
        setSkills(r.skills);
        setProviders(r.providers);
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));

  useEffect(() => {
    void load();
    // Refresh registry periodically so schedule/running state stays current.
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Empty>{t("workers_failed_load").replace("{error}", error)}</Empty>;

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg-dim">{t("workers_crew")}</h2>
        {!creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t("workers_new")}
          </Button>
        )}
      </div>

      {creating && (
        <Card title={t("workers_new_card")}>
          <WorkerForm
            skills={skills}
            providers={providers}
            workers={workers}
            initial={emptyForm}
            onCancel={() => setCreating(false)}
            onSubmit={async (form) => {
              await api.createWorker(form);
              setCreating(false);
              await load();
            }}
            onAuthError={onAuthError}
          />
        </Card>
      )}

      {workers.length === 0 && !creating ? (
        <Empty>{t("workers_empty")}</Empty>
      ) : (
        (() => {
          const leads = workers.filter((w) => w.role === "lead");
          const assistants = workers.filter((w) => w.role === "assistant");
          const specialists = workers.filter(
            (w) => !w.role || (w.role !== "lead" && w.role !== "assistant"),
          );
          const row = (w: Worker) => (
            <WorkerRow
              key={w.id}
              worker={w}
              skills={skills}
              providers={providers}
              workers={workers}
              live={live[w.id]}
              onChange={load}
              onAuthError={onAuthError}
            />
          );
          const parented = new Set<string>();
          return (
            <>
              {leads.map((lead) => {
                const kids = assistants.filter((a) => a.parentId === lead.id);
                kids.forEach((k) => parented.add(k.id));
                return (
                  <div key={lead.id} className="space-y-4">
                    {row(lead)}
                    {kids.length > 0 && <div className="ml-4 space-y-4">{kids.map(row)}</div>}
                  </div>
                );
              })}
              {assistants.filter((a) => !parented.has(a.id)).map(row)}
              {specialists.map(row)}
            </>
          );
        })()
      )}
    </div>
  );
}

function WorkerRow({
  worker,
  skills,
  providers,
  workers,
  live,
  onChange,
  onAuthError,
}: {
  worker: Worker;
  skills: Named[];
  providers: Named[];
  workers: Worker[];
  live?: LiveRun;
  onChange: () => void;
  onAuthError: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<WorkerRun[]>([]);
  const running = worker.running || live?.status === "running";
  const providerName = providers.find((p) => p.id === worker.providerId)?.name;

  const loadRuns = () => api.workerRuns(worker.id).then((r) => setRuns(r.runs));
  useEffect(() => {
    if (open) void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, live?.status]);

  const run = async () => {
    try {
      await api.runWorker(worker.id);
      setOpen(true);
      onChange();
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    }
  };
  const stop = async () => {
    await api.stopWorker(worker.id);
    onChange();
  };
  const del = async () => {
    if (!confirm(t("workers_delete_confirm").replace("{name}", worker.name))) return;
    await api.deleteWorker(worker.id);
    onChange();
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">{worker.name}</span>
        {worker.role === "lead" && <Badge tone="blue">{t("workers_lead")}</Badge>}
        {worker.role === "assistant" && <Badge tone="zinc">{t("workers_assistant")}</Badge>}
        {worker.portfolio && <Badge>{worker.portfolio}</Badge>}
        <Badge tone={worker.schedule === "manual" ? "zinc" : "blue"}>{worker.schedule}</Badge>
        {worker.model && <Badge>{shortModel(worker.model)}</Badge>}
        {providerName && <Badge tone="blue">⌂ {providerName}</Badge>}
        {!worker.enabled && <Badge tone="amber">{t("disabled")}</Badge>}
        {running && <Badge tone="green">{t("running")}</Badge>}
        <span className="ml-auto flex gap-1.5">
          {running ? (
            <Button variant="danger" onClick={stop}>
              {t("stop")}
            </Button>
          ) : (
            <Button variant="primary" onClick={run}>
              {t("workers_run_now")}
            </Button>
          )}
          <Button onClick={() => setOpen((o) => !o)}>{open ? t("hide") : t("details")}</Button>
          <Button onClick={() => setEditing((e) => !e)}>{t("edit")}</Button>
          <Button variant="danger" onClick={del}>
            {t("delete")}
          </Button>
        </span>
      </div>

      <div className="mt-1 truncate font-mono text-xs text-fg-faint" title={worker.cwd}>
        {worker.cwd || t("workers_no_cwd")}
        {worker.nextRunAt && ` · ${t("workers_next").replace("{time}", relTime(worker.nextRunAt))}`}
      </div>

      {editing && (
        <div className="mt-3 border-t border-line pt-3">
          <WorkerForm
            skills={skills}
            providers={providers}
            workers={workers}
            initial={{
              name: worker.name,
              cwd: worker.cwd,
              prompt: worker.prompt,
              model: worker.model,
              providerId: worker.providerId,
              systemPrompt: worker.systemPrompt,
              skillId: worker.skillId,
              when: worker.when,
              role: worker.role ?? "",
              portfolio: worker.portfolio ?? "",
              parentId: worker.parentId ?? "",
              telegramToken: worker.telegramToken ?? "",
              persona: worker.persona ?? "",
              autonomy: worker.autonomy ?? "full",
              language: worker.language ?? "",
            }}
            enabled={worker.enabled}
            onCancel={() => setEditing(false)}
            onSubmit={async (form, enabled) => {
              await api.updateWorker(worker.id, { ...form, enabled });
              setEditing(false);
              onChange();
            }}
            onAuthError={onAuthError}
          />
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <LiveOutput live={live} />
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-dim">
              {t("workers_run_history")}
            </div>
            {runs.length === 0 ? (
              <p className="text-xs text-fg-faint">{t("workers_no_runs")}</p>
            ) : (
              <div className="space-y-1">
                {runs.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <Badge tone={r.status === "ok" ? "green" : r.status === "error" ? "amber" : "zinc"}>
                      {r.status}
                    </Badge>
                    <span className="tabular text-fg-dim">{relTime(r.startedAt)}</span>
                    {r.durationMs != null && (
                      <span className="tabular text-fg-faint">{ms(r.durationMs)}</span>
                    )}
                    {r.costUsd != null && (
                      <span className="tabular text-fg-faint">{usd(r.costUsd)}</span>
                    )}
                    {r.error && <span className="truncate text-red-400">{r.error}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function LiveOutput({ live }: { live?: LiveRun }) {
  const { t } = useI18n();
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [live?.output]);

  if (!live) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-fg-dim">
        {t("workers_live_output")}
        {live.status === "running" && <Badge tone="green">{t("workers_streaming")}</Badge>}
        {live.tool && <span className="font-mono normal-case text-fg-faint">🔧 {live.tool}</span>}
      </div>
      <pre
        ref={ref}
        className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-input p-3 text-xs text-fg-muted"
      >
        {live.output || "…"}
      </pre>
    </div>
  );
}

function WorkerForm({
  skills,
  providers,
  workers,
  initial,
  enabled: initialEnabled = true,
  onCancel,
  onSubmit,
  onAuthError,
}: {
  skills: Named[];
  providers: Named[];
  workers: Worker[];
  initial: Form;
  enabled?: boolean;
  onCancel: () => void;
  onSubmit: (form: Form, enabled: boolean) => Promise<void>;
  onAuthError: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<Form>(initial);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const listId = useId();

  const fetchModels = async () => {
    if (!form.providerId) return;
    setFetchingModels(true);
    try {
      const r = await api.providerModels(form.providerId);
      setFetched(r.models);
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    } finally {
      setFetchingModels(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(form, enabled);
    } catch (e) {
      if (e instanceof AuthError) onAuthError();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("workers_name")}</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <Label>{t("workers_cwd")}</Label>
          <Input
            value={form.cwd}
            onChange={(e) => setForm({ ...form, cwd: e.target.value })}
            placeholder={t("workers_cwd_placeholder")}
          />
        </div>
      </div>
      <div>
        <Label>{t("workers_task")}</Label>
        <TextArea
          rows={4}
          value={form.prompt}
          onChange={(e) => setForm({ ...form, prompt: e.target.value })}
          placeholder={t("workers_task_placeholder")}
        />
      </div>
      <div>
        <Label>{t("workers_persona_label")}</Label>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {PERSONA_PRESETS.map((p) => (
            <button
              key={p.labelKey}
              type="button"
              onClick={() => setForm({ ...form, persona: p.value })}
              className={`rounded px-2 py-0.5 text-xs border transition-colors ${
                form.persona === p.value
                  ? "bg-[var(--accent)] text-white border-transparent"
                  : "border-line text-fg-dim hover:text-fg"
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
          {form.persona && !PERSONA_PRESETS.find((p) => p.value === form.persona) && (
            <span className="rounded px-2 py-0.5 text-xs border border-line text-fg-dim">{t("workers_custom")}</span>
          )}
        </div>
        <TextArea
          rows={2}
          value={form.persona}
          onChange={(e) => setForm({ ...form, persona: e.target.value })}
          placeholder={t("workers_persona_placeholder")}
        />
      </div>
      <div>
        <Label>{t("workers_domain")}</Label>
        <TextArea
          rows={3}
          value={form.systemPrompt}
          onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t("workers_provider")}</Label>
          <Select
            value={form.providerId}
            onChange={(e) => setForm({ ...form, providerId: e.target.value })}
          >
            <option value="">{t("workers_anthropic_default")}</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("workers_model")}</Label>
          <div className="flex gap-2">
            <Input
              list={listId}
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              placeholder={form.providerId ? t("workers_model_local") : t("workers_model_default")}
            />
            {form.providerId && (
              <Button onClick={fetchModels} disabled={fetchingModels} className="shrink-0">
                {fetchingModels ? "…" : t("fetch")}
              </Button>
            )}
          </div>
          <datalist id={listId}>
            {[...new Set([...(form.providerId ? fetched : MODEL_SUGGESTIONS), ...fetched])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {form.providerId && fetched.length > 0 && (
            <p className="mt-1 text-xs text-fg-faint">{t("workers_models_available").replace("{n}", String(fetched.length))}</p>
          )}
        </div>
        <div>
          <Label>{t("workers_skill")}</Label>
          <Select
            value={form.skillId}
            onChange={(e) => setForm({ ...form, skillId: e.target.value })}
          >
            <option value="">{t("workers_skill_none")}</option>
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("workers_schedule")}</Label>
          <Input
            value={form.when}
            onChange={(e) => setForm({ ...form, when: e.target.value })}
            placeholder={t("workers_schedule_placeholder")}
          />
        </div>
        <div>
          <Label>{t("workers_role")}</Label>
          <Select
            value={form.role}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value as Form["role"] })
            }
          >
            <option value="">{t("workers_role_specialist")}</option>
            <option value="lead">{t("workers_role_lead")}</option>
            <option value="assistant">{t("workers_role_assistant")}</option>
          </Select>
        </div>
        {(form.role === "lead" || form.role === "assistant") && (
          <div>
            <Label>{t("workers_portfolio")}</Label>
            <Input
              value={form.portfolio}
              onChange={(e) => setForm({ ...form, portfolio: e.target.value })}
              placeholder={t("workers_role_portfolio_placeholder")}
            />
          </div>
        )}
        {form.role === "assistant" && (
          <div>
            <Label>{t("workers_parent")}</Label>
            <Select
              value={form.parentId}
              onChange={(e) => setForm({ ...form, parentId: e.target.value })}
            >
              <option value="">{t("workers_parent_none")}</option>
              {workers
                .filter((w) => w.role === "lead")
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </Select>
          </div>
        )}
        {form.role === "lead" && (
          <div>
            <Label>{t("workers_token")}</Label>
            <Input
              value={form.telegramToken}
              onChange={(e) => setForm({ ...form, telegramToken: e.target.value })}
              placeholder={t("workers_token_placeholder")}
            />
          </div>
        )}
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {t("workers_enabled")}
          </label>
        </div>
        <div>
          <Label>{t("autonomy")}</Label>
          <div className="mt-1 flex gap-1.5">
            {(["supervised", "standard", "full"] as Autonomy[]).map((a) => (
              <button
                key={a}
                onClick={() => setForm({ ...form, autonomy: a })}
                className={`rounded px-2 py-1 text-xs border transition-colors ${
                  form.autonomy === a
                    ? "bg-[var(--accent)] text-white border-transparent"
                    : "border-line text-fg-dim hover:text-fg"
                }`}
              >
                {t(AUTONOMY_KEY[a])}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>{t("workers_lang_label")}</Label>
          <Select
            value={form.language}
            onChange={(e) => setForm({ ...form, language: e.target.value })}
          >
            <option value="">{t("workers_lang_default")}</option>
            {Object.entries(AGENT_LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          variant="primary"
          onClick={submit}
          disabled={busy || !form.name.trim() || !form.cwd.trim() || !form.prompt.trim()}
        >
          {busy ? t("saving") : t("workers_save")}
        </Button>
        <Button onClick={onCancel}>{t("cancel")}</Button>
      </div>
    </div>
  );
}
