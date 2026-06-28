import { useState } from "react";
import { checkToken, setToken } from "../api.ts";
import { useI18n } from "../lib/useI18n.ts";

export function Login({ onAuthed }: { onAuthed: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await checkToken(value.trim());
      if (!ok) {
        setError(t("login_invalid"));
        return;
      }
      setToken(value.trim());
      onAuthed();
    } catch {
      setError(t("login_unreachable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6"
      >
        <h1 className="text-lg font-semibold text-fg">{t("login_title")}</h1>
        <p className="mt-1 text-sm text-fg-dim">{t("login_desc")}</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="PANEL_TOKEN"
          className="mt-4 w-full rounded-lg border border-line bg-input px-3 py-2 text-sm text-fg outline-none focus:border-accent"
        />
        {error && <p className="mt-2 text-sm text-critical-fg">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("checking") : t("login_unlock")}
        </button>
      </form>
    </div>
  );
}
