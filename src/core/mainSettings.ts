import { config } from "../config.js";
import { loadJson, saveJson } from "./jsonStore.js";
import { getProvider, listProviders } from "./providers.js";
import { resolveSecret } from "./vault.js";
import { audit } from "./audit.js";
import type { Autonomy } from "../session/manager.js";

const FILE = "mainAgent.json";

/** The main bot's resolved @username (from getMe), captured at startup. Transient
 *  runtime state, not persisted: it's an identity of the running process, not a
 *  user setting. Exposed in the panel view so Crew can show Atlas's t.me link. */
let botUsername: string | undefined;
export function setMainBotUsername(username: string): void {
  botUsername = username || undefined;
}

/** Runtime overrides for the *main* bot agent (the one driving chats). Empty
 *  fields fall back to CLAUDE_MODEL / the process env (.env) respectively. */
interface MainSettings {
  /** Model id override; "" = use CLAUDE_MODEL. */
  model?: string;
  /** Provider for a local/proxy endpoint; "" = Anthropic via process env. */
  providerId?: string;
  /**
   * Character and tone override for Atlas. If set, injected into the system
   * prompt after the base personality block. Separate from systemPrompt (domain
   * knowledge). Example: "formal and precise, no jokes".
   */
  persona?: string;
  /**
   * Default autonomy level for Atlas.
   * supervised = all tools prompt the user.
   * standard   = safe tools auto-allowed, risky tools prompt (default).
   * full       = bypass all permissions.
   */
  autonomy?: Autonomy;
  /**
   * BCP 47 language tag for Atlas's default response language.
   * Per-session /lang overrides this. Falls back to DEFAULT_LANGUAGE env var.
   */
  defaultLanguage?: string;
}

interface MainFile {
  version: 1;
  settings: MainSettings;
}

function load(): MainSettings {
  return loadJson<MainFile>(FILE, { version: 1, settings: {} }).settings;
}

/** Panel-facing view: raw selection plus the effective/resolved values. */
export function mainSettingsView() {
  const s = load();
  const provider = s.providerId ? getProvider(s.providerId) : undefined;
  return {
    model: s.model ?? "",
    providerId: s.providerId ?? "",
    effectiveModel: s.model || config.CLAUDE_MODEL,
    providerName: provider?.name,
    providerBaseUrl: provider?.baseUrl,
    providers: listProviders().map((p) => ({ id: p.id, name: p.name })),
    persona: s.persona ?? "",
    autonomy: s.autonomy ?? "standard",
    defaultLanguage: s.defaultLanguage ?? config.DEFAULT_LANGUAGE,
    botUsername: botUsername ?? "",
  };
}

export function setMainSettings(patch: {
  model?: string;
  providerId?: string;
  persona?: string;
  autonomy?: Autonomy;
  defaultLanguage?: string;
}): void {
  const s = load();
  if (patch.model !== undefined) s.model = patch.model.trim() || undefined;
  if (patch.providerId !== undefined) s.providerId = patch.providerId || undefined;
  if (patch.persona !== undefined) s.persona = patch.persona.trim() || undefined;
  if (patch.autonomy !== undefined) s.autonomy = patch.autonomy || undefined;
  if (patch.defaultLanguage !== undefined) s.defaultLanguage = patch.defaultLanguage || undefined;
  saveJson<MainFile>(FILE, { version: 1, settings: s });
  audit("mainAgent.update", { model: s.model, providerId: s.providerId });
}

/** Per-turn overrides for a main (bot) turn: model + provider env + persona, if set.
 *  Mirrors how workers resolve a provider, so main turns can run on a local
 *  model too. Returns empty object when nothing is overridden. */
export function resolveMainRun(): {
  model?: string;
  env?: Record<string, string | undefined>;
  persona?: string;
  autonomy: Autonomy;
  defaultLanguage?: string;
} {
  const s = load();
  const provider = s.providerId ? getProvider(s.providerId) : undefined;
  const env = provider
    ? {
        ANTHROPIC_BASE_URL: provider.baseUrl,
        ANTHROPIC_AUTH_TOKEN: resolveSecret(provider.authToken),
        ANTHROPIC_API_KEY: undefined,
      }
    : undefined;
  return {
    model: s.model || undefined,
    env,
    persona: s.persona || undefined,
    autonomy: s.autonomy ?? "standard",
    defaultLanguage: s.defaultLanguage || undefined,
  };
}
