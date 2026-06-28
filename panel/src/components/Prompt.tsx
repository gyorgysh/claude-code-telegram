import { useEffect, useState } from "react";
import { api, AuthError, type PromptView } from "../api.ts";
import { Button, Card, Empty, TextArea } from "./ui.tsx";
import { useI18n } from "../lib/useI18n.ts";

export function PromptView_({ onAuthError }: { onAuthError: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<PromptView | null>(null);
  const [work, setWork] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPersona, setShowPersona] = useState(false);

  useEffect(() => {
    api
      .prompt()
      .then((p) => {
        setData(p);
        setWork(p.work);
      })
      .catch((e) => (e instanceof AuthError ? onAuthError() : setError(String(e))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <Empty>{t("prompt_failed_load").replace("{error}", error)}</Empty>;
  if (!data) return <Empty>{t("loading")}</Empty>;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.savePrompt(work);
      setData(next);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      if (e instanceof AuthError) return onAuthError();
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title={t("prompt_playbook_title")}
        right={
          <span className="font-mono text-xs text-fg-faint" title={data.workFile}>
            {data.exists ? "work.md" : t("prompt_work_new")}
          </span>
        }
      >
        <p className="mb-3 text-sm text-fg-dim">{t("prompt_desc")}</p>
        <TextArea
          rows={18}
          value={work}
          onChange={(e) => {
            setWork(e.target.value);
            setDirty(true);
          }}
          placeholder={t("prompt_placeholder")}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={save} disabled={saving || !dirty}>
            {saving ? t("saving") : t("prompt_save")}
          </Button>
          {saved && <span className="text-xs text-ok-fg">{t("saved")}</span>}
          {dirty && !saved && <span className="text-xs text-fg-faint">{t("prompt_unsaved")}</span>}
        </div>
      </Card>

      <Card
        title={t("prompt_personality_title")}
        right={
          <Button onClick={() => setShowPersona((s) => !s)}>
            {showPersona ? t("hide") : t("show")}
          </Button>
        }
      >
        <p className="text-sm text-fg-dim">
          {t("prompt_personality_desc_pre")}<code>src/prompt.ts</code>{t("prompt_personality_desc_post")}
        </p>
        {showPersona && (
          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-input p-3 text-xs text-fg-muted">
            {data.personality}
          </pre>
        )}
      </Card>
    </div>
  );
}
