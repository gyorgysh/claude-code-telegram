import { Markup, type Telegram } from "telegraf";
import { sessions } from "../session/manager.js";
import { log } from "../logger.js";
import { t, langForChat } from "./i18n/index.js";

/** Auto-resume after this long if the user doesn't tap a button. */
const AUTO_RESUME_MS = 10_000;

const CB_PREFIX = "rsm";

interface Pending {
  chatId: number;
  /** Runs the held-back user prompt once a decision is made. */
  run: () => void;
  /** Fires the auto-resume if no button is pressed in time. */
  timeout: NodeJS.Timeout;
  /** The offer message, edited in place to reflect the decision. */
  messageId?: number;
}

/** One in-flight resume offer per chat (keyed by chatId). */
const pending = new Map<number, Pending>();

function offerKeyboard(lang: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(t("resume_btn", lang), `${CB_PREFIX}:resume`),
      Markup.button.callback(t("resume_fresh_btn", lang), `${CB_PREFIX}:fresh`),
    ],
  ]);
}

/**
 * If `chatId` is on its first message since a restart and has a persisted Claude
 * context, post an inline "resume vs fresh" offer and hold back `run` until the
 * user decides (auto-resuming after {@link AUTO_RESUME_MS}). Returns true when
 * the offer was shown and `run` was deferred; false when there's nothing to
 * resume (caller should run the prompt normally).
 */
export async function maybeOfferResume(
  tg: Telegram,
  chatId: number,
  run: () => void,
): Promise<boolean> {
  if (!sessions.isFirstSinceRestart(chatId)) return false;

  // A second prompt arriving while an offer is open: resolve the open one by
  // resuming immediately, then let this prompt run normally.
  const existing = pending.get(chatId);
  if (existing) {
    finish(tg, chatId, "resume");
    return false;
  }

  log.info("Offering session resume after restart", { chatId });
  const lang = langForChat(chatId);
  const msg = await tg
    .sendMessage(
      chatId,
      t("resume_offer", lang, { seconds: AUTO_RESUME_MS / 1000 }),
      { parse_mode: "HTML", ...offerKeyboard(lang) },
    )
    .catch(() => undefined);

  const timeout = setTimeout(() => {
    log.info("Session resume offer timed out — auto-resuming", { chatId });
    finish(tg, chatId, "resume");
  }, AUTO_RESUME_MS);
  timeout.unref?.();

  pending.set(chatId, { chatId, run, timeout, messageId: msg?.message_id });
  return true;
}

export function isResumeCallback(data: string): boolean {
  return data.startsWith(`${CB_PREFIX}:`);
}

/** Resolve a resume-offer button press; returns a short toast for answerCbQuery. */
export function resolveResumeCallback(tg: Telegram, chatId: number, data: string): string {
  const lang = langForChat(chatId);
  const action = data.slice(CB_PREFIX.length + 1) === "fresh" ? "fresh" : "resume";
  if (!pending.has(chatId)) return t("resume_expired", lang);
  finish(tg, chatId, action);
  return action === "fresh" ? t("resume_starting_fresh", lang) : t("resume_resuming", lang);
}

/** Apply the decision: clear context on "fresh", then run the held prompt. */
function finish(tg: Telegram, chatId: number, action: "resume" | "fresh"): void {
  const entry = pending.get(chatId);
  if (!entry) return;
  pending.delete(chatId);
  clearTimeout(entry.timeout);

  if (action === "fresh") {
    sessions.reset(chatId);
    log.info("Session reset before turn — fresh start chosen", { chatId });
  }

  if (entry.messageId !== undefined) {
    const lang = langForChat(chatId);
    const note =
      action === "fresh"
        ? t("resume_started_fresh", lang)
        : t("resume_resumed", lang);
    void tg
      .editMessageText(chatId, entry.messageId, undefined, note, { parse_mode: "HTML" })
      .catch(() => {});
  }

  entry.run();
}
