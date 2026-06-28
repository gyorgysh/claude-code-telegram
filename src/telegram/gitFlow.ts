import { basename } from "node:path";
import { Markup, type Telegram } from "telegraf";
import { sessions } from "../session/manager.js";
import { log } from "../logger.js";
import { escapeHtml } from "./formatting.js";
import { CALLBACK_MAX_BYTES } from "./callback.js";
import { t, langForChat } from "./i18n/index.js";
import * as git from "../git.js";

const DIFF_INLINE_LIMIT = 3500; // above this we send the diff as a .diff file

/** Inline keyboard shown under a diff: one-tap commit or (confirmed) discard. */
function reviewKeyboard(lang: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t("git_commit_all", lang), "git:commit")],
    [Markup.button.callback(t("git_discard_all", lang), "git:discard")],
  ]);
}

function confirmDiscardKeyboard(lang: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t("git_confirm_discard_btn", lang), "git:discard_confirm")],
    [Markup.button.callback(t("git_cancel", lang), "git:cancel")],
  ]);
}

/** Reply to /diff: show working-tree status + diff, with review buttons. */
export async function sendDiff(tg: Telegram, chatId: number): Promise<void> {
  const lang = langForChat(chatId);
  const cwd = sessions.get(chatId).cwd;
  if (!(await git.isRepo(cwd))) {
    await tg.sendMessage(chatId, t("git_not_repo", lang, { cwd: escapeHtml(cwd) }), {
      parse_mode: "HTML",
    });
    return;
  }

  const files = await git.changedFiles(cwd);
  if (files.length === 0) {
    await tg.sendMessage(chatId, t("git_clean", lang));
    return;
  }

  const status = await git.status(cwd);
  const diff = await git.diff(cwd);
  const header = t(files.length === 1 ? "git_changes_one" : "git_changes_many", lang, {
    dir: escapeHtml(basename(cwd)),
    n: files.length,
    status: escapeHtml(status.out),
  });

  if (diff.out.length > DIFF_INLINE_LIMIT) {
    // Too big for a readable message — deliver as a .diff file with the buttons.
    await tg.sendMessage(chatId, header, { parse_mode: "HTML" });
    await tg.sendDocument(
      chatId,
      { source: Buffer.from(diff.out || "(no textual diff)"), filename: `${basename(cwd)}.diff` },
      { caption: t("git_review_caption", lang), ...reviewKeyboard(lang) },
    );
    return;
  }

  await tg.sendMessage(chatId, `${header}\n<pre>${escapeHtml(diff.out)}</pre>`, {
    parse_mode: "HTML",
    ...reviewKeyboard(lang),
  });
}

export function isGitCallback(data: string): boolean {
  return data.startsWith("git:");
}

/**
 * Resolve a git review button press. Returns a short toast for answerCbQuery.
 * `edit` lets us swap the keyboard (e.g. to a discard confirmation) in place.
 */
export async function resolveGitCallback(
  tg: Telegram,
  chatId: number,
  data: string,
  messageId: number | undefined,
): Promise<string> {
  if (Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) return "";
  const lang = langForChat(chatId);
  const action = data.slice("git:".length);
  const cwd = sessions.get(chatId).cwd;

  if (action === "discard") {
    if (messageId !== undefined) {
      await tg.editMessageReplyMarkup(
        chatId,
        messageId,
        undefined,
        confirmDiscardKeyboard(lang).reply_markup,
      ).catch(() => {});
    }
    return t("git_confirm_discard_toast", lang);
  }

  if (action === "cancel") {
    if (messageId !== undefined) {
      await clearKeyboard(tg, chatId, messageId);
    }
    return t("git_cancelled", lang);
  }

  if (action === "commit") {
    const message = t("git_auto_commit_msg", lang, { iso: new Date().toISOString() });
    const res = await git.commitAll(cwd, message);
    log.info("Git commit via button", { chatId, ok: res.ok });
    await tg.sendMessage(
      chatId,
      res.ok
        ? t("git_committed", lang, { out: escapeHtml(res.out) })
        : t("git_commit_failed", lang, { out: escapeHtml(res.out) }),
      { parse_mode: "HTML" },
    );
    if (messageId !== undefined) await clearKeyboard(tg, chatId, messageId);
    return res.ok ? t("git_committed_toast", lang) : t("git_commit_failed_toast", lang);
  }

  if (action === "discard_confirm") {
    const res = await git.discardTracked(cwd);
    log.info("Git discard via button", { chatId, ok: res.ok });
    await tg.sendMessage(
      chatId,
      res.ok
        ? t("git_discarded", lang)
        : t("git_discard_failed", lang, { out: escapeHtml(res.out) }),
      { parse_mode: "HTML" },
    );
    if (messageId !== undefined) await clearKeyboard(tg, chatId, messageId);
    return res.ok ? t("git_discarded_toast", lang) : t("git_discard_failed_toast", lang);
  }

  return "";
}

async function clearKeyboard(tg: Telegram, chatId: number, messageId: number): Promise<void> {
  await tg.editMessageReplyMarkup(chatId, messageId, undefined, { inline_keyboard: [] }).catch(() => {});
}
