import { Markup, type Telegram } from "telegraf";
import { sessions } from "../session/manager.js";
import { log } from "../logger.js";

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

function offerKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("↩️ Resume previous context", `${CB_PREFIX}:resume`),
      Markup.button.callback("🆕 Fresh start", `${CB_PREFIX}:fresh`),
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
  const msg = await tg
    .sendMessage(
      chatId,
      "♻️ I restarted since we last spoke. Resume our previous conversation, " +
        `or start fresh?\n\n<i>Auto-resuming in ${AUTO_RESUME_MS / 1000}s…</i>`,
      { parse_mode: "HTML", ...offerKeyboard() },
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
  const action = data.slice(CB_PREFIX.length + 1) === "fresh" ? "fresh" : "resume";
  if (!pending.has(chatId)) return "This prompt has expired.";
  finish(tg, chatId, action);
  return action === "fresh" ? "Starting fresh" : "Resuming previous context";
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
    const note =
      action === "fresh"
        ? "🆕 <i>Started a fresh conversation.</i>"
        : "↩️ <i>Resumed the previous conversation.</i>";
    void tg
      .editMessageText(chatId, entry.messageId, undefined, note, { parse_mode: "HTML" })
      .catch(() => {});
  }

  entry.run();
}
