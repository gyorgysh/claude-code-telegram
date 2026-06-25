import { useEffect, useState } from "react";
import { api, AuthError, type SecretView } from "../api.ts";
import { useI18n } from "../lib/useI18n.ts";
import { Badge, Button, Callout, Card, Empty, Input, Label } from "./ui.tsx";

const blank = { name: "", value: "", description: "" };

export function VaultView({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<SecretView[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof blank>(blank);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = () =>
    api
      .vault()
      .then((r) => setSecrets(r.secrets))
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startNew = () => {
    setForm(blank);
    setEditing("new");
  };
  const startEdit = (s: SecretView) => {
    setForm({ name: s.name, value: "", description: s.description });
    setEditing(s.id);
  };

  const save = async () => {
    try {
      if (editing === "new") await api.createSecret(form);
      else if (editing) await api.updateSecret(editing, form); // empty value = keep existing
      setEditing(null);
      await load();
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(String(e));
    }
  };

  const reveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    const { value } = await api.revealSecret(id);
    setRevealed((r) => ({ ...r, [id]: value }));
  };

  const del = async (id: string) => {
    if (!confirm(t("vault_delete_confirm"))) return;
    await api.deleteSecret(id);
    await load();
  };

  const importProviders = async () => {
    const { imported } = await api.importSecrets();
    setStatus(imported ? t("vault_imported").replace("{n}", String(imported)) : t("vault_no_import"));
    setTimeout(() => setStatus(null), 4000);
    await load();
  };

  return (
    <Card
      title={t("vault_title")}
      right={
        editing ? null : (
          <Button variant="primary" onClick={startNew}>
            {t("vault_new")}
          </Button>
        )
      }
    >
      <p className="mb-3 text-sm text-fg-dim">{t("vault_desc")}</p>

      <Callout title={t("vault_migrate_title")} dismissId="vault-import">
        {t("vault_migrate_desc")}
        <div className="mt-2">
          <Button onClick={importProviders}>{t("vault_scan_import")}</Button>
          {status && <span className="ml-2 text-xs text-emerald-400">{status}</span>}
        </div>
      </Callout>

      {error && <p className="my-2 text-sm text-red-400">{error}</p>}

      {editing && (
        <div className="my-4 space-y-3 rounded-lg border border-line bg-input p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>{t("vault_name")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t("vault_name_placeholder")}
              />
            </div>
            <div>
              <Label>{t("vault_description")}</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>{editing === "new" ? t("vault_value") : t("vault_value_edit")}</Label>
            <Input
              type="password"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="••••••••"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="primary"
              onClick={save}
              disabled={!form.name.trim() || (editing === "new" && !form.value)}
            >
              {t("save")}
            </Button>
            <Button onClick={() => setEditing(null)}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {secrets.length === 0 && !editing ? (
        <Empty>{t("vault_empty")}</Empty>
      ) : (
        <div className="mt-3 space-y-2">
          {secrets.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-line p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-fg">{s.name}</span>
                  <Badge>vault:{s.id}</Badge>
                </div>
                {s.description && <p className="text-sm text-fg-dim">{s.description}</p>}
                <p className="mono mt-1 text-xs text-fg-faint">
                  {revealed[s.id] !== undefined ? revealed[s.id] : s.hint}
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button onClick={() => reveal(s.id)}>
                  {revealed[s.id] !== undefined ? t("hide") : t("vault_reveal")}
                </Button>
                <Button onClick={() => startEdit(s)}>{t("edit")}</Button>
                <Button variant="danger" onClick={() => del(s.id)}>
                  {t("delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
