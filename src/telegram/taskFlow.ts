import type { Telegram } from "telegraf";
import { taskDelegator } from "../core/taskRunner.js";
import { getTask } from "../core/tasks.js";
import { log } from "../logger.js";
import { parseCallback, isHexId } from "./callback.js";
import { t, langForChat } from "./i18n/index.js";

/**
 * Telegram inline-button flow for failed delegated tasks. When a delegation
 * errors, the president gets a "🔁 Retry" button (callback `task:retry:<id>`)
 * that resets the card to backlog and re-delegates in one tap. Namespaced like
 * the git/project/inbox flows and routed through the shared callback_query
 * handler in bot.ts.
 */

const NS = "task:";

export function isTaskCallback(data: string): boolean {
  return data.startsWith(NS);
}

/** Inline keyboard markup offering a Retry button for a failed card. */
export function retryKeyboard(taskId: string, lang?: string) {
  return {
    inline_keyboard: [[{ text: t("task_retry_btn", lang), callback_data: `${NS}retry:${taskId}` }]],
  };
}

/**
 * Resolve a task callback. Returns a short toast for answerCbQuery. On a
 * successful retry it strips the keyboard from the original message so it can't
 * be tapped twice.
 */
export async function resolveTaskCallback(
  tg: Telegram,
  chatId: number,
  data: string,
  messageId?: number,
): Promise<string> {
  const lang = langForChat(chatId);
  const parts = parseCallback(data, NS, 2);
  if (!parts) return t("task_unknown_action", lang);
  const [action, taskId] = parts;
  if (action !== "retry" || !isHexId(taskId)) return t("task_unknown_action", lang);

  const task = getTask(taskId);
  if (!task) return t("task_gone", lang);

  const r = taskDelegator.retry(taskId);
  if (!r.ok)
    return r.error === "already running"
      ? t("task_already_running", lang)
      : (r.error ?? t("task_could_not_retry", lang));

  log.info("Task retry from Telegram", { taskId, retryCount: r.retryCount });
  // Remove the Retry button so it can't be pressed again for this run.
  if (messageId !== undefined) {
    await tg.editMessageReplyMarkup(chatId, messageId, undefined, { inline_keyboard: [] }).catch(() => {});
  }
  return r.retryCount
    ? t("task_retrying_attempt", lang, { n: r.retryCount + 1 })
    : t("task_retrying", lang);
}
