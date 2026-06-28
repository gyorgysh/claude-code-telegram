import { en, type TranslationKey } from "./en.js";
import { hu } from "./hu.js";
import { sessions } from "../../session/manager.js";
import { resolveMainRun } from "../../core/mainSettings.js";

export type { TranslationKey };

/**
 * Catalogs we actually ship translations for. The session language is a BCP-47
 * code from the 30-language `AGENT_LANGUAGES` catalogue, but only these have a
 * bot-side string catalog; everything else falls back to English (the agent's
 * reply is still in the chosen language, only these fixed UI strings aren't).
 */
const CATALOGS: Record<string, Record<TranslationKey, string>> = { en, hu };

/** Map a BCP-47 code to a catalog key we have, else "en". */
export function resolveCatalog(lang?: string): string {
  if (!lang) return "en";
  if (CATALOGS[lang]) return lang;
  // Fold region variants (e.g. "pt-BR") onto the base language if we ship it.
  const base = lang.split("-")[0];
  return CATALOGS[base] ? base : "en";
}

/**
 * Translate `key` into `lang`, filling `{name}` placeholders from `vars`.
 * Falls back to the English string (then the key itself) if missing.
 */
export function t(
  key: TranslationKey,
  lang?: string,
  vars?: Record<string, string | number>,
): string {
  const catalog = CATALOGS[resolveCatalog(lang)] ?? en;
  let s = catalog[key] ?? en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

/**
 * Resolve the operational-UI language for a chat: the session's `/lang`
 * override, else the main agent's `defaultLanguage`, else English. This is the
 * same resolution `runTurn` uses for the model reply language, so the bot's own
 * strings match the agent's output language.
 */
export function langForChat(chatId: number): string {
  const session = sessions.get(chatId);
  return session.language ?? resolveMainRun().defaultLanguage ?? "en";
}
