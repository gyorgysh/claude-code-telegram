import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { Markup, type Telegram } from "telegraf";
import { sessions } from "../session/manager.js";
import { log } from "../logger.js";
import { escapeHtml } from "./formatting.js";
import { parseCallback, isHexId } from "./callback.js";
import { t, langForChat } from "./i18n/index.js";
import * as git from "../git.js";

const DIFF_INLINE_LIMIT = 3500; // above this we send the diff as a .diff file

/**
 * Pending /diff review contexts, keyed by a random id embedded in the buttons.
 * The buttons are otherwise stateless: they used to act on the CURRENT session
 * cwd, so tapping "Commit all" / "discard everything" on an old /diff message
 * after a /cd (or a restart days later) would commit/discard the WRONG working
 * tree. Binding each button set to the exact repo the diff was rendered for — and
 * expiring unknown ids — closes that. In-memory + TTL, so a press after restart
 * cleanly reports "expired".
 */
const reviews = new Map<string, { cwd: string; at: number }>();
const REVIEW_TTL_MS = 60 * 60 * 1000;

function newReview(cwd: string): string {
  const now = Date.now();
  for (const [k, v] of reviews) if (now - v.at > REVIEW_TTL_MS) reviews.delete(k);
  const id = randomBytes(4).toString("hex");
  reviews.set(id, { cwd, at: now });
  return id;
}

/** Inline keyboard shown under a diff: one-tap commit or (confirmed) discard. */
function reviewKeyboard(lang: string, id: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t("git_commit_all", lang), `git:commit:${id}`)],
    [Markup.button.callback(t("git_discard_all", lang), `git:discard:${id}`)],
  ]);
}

function confirmDiscardKeyboard(lang: string, id: string) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(t("git_confirm_discard_btn", lang), `git:discard_confirm:${id}`)],
    [Markup.button.callback(t("git_cancel", lang), `git:cancel:${id}`)],
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
  const id = newReview(cwd);

  if (diff.out.length > DIFF_INLINE_LIMIT) {
    // Too big for a readable message — deliver as a .diff file with the buttons.
    await tg.sendMessage(chatId, header, { parse_mode: "HTML" });
    await tg.sendDocument(
      chatId,
      { source: Buffer.from(diff.out || "(no textual diff)"), filename: `${basename(cwd)}.diff` },
      { caption: t("git_review_caption", lang), ...reviewKeyboard(lang, id) },
    );
    return;
  }

  await tg.sendMessage(chatId, `${header}\n<pre>${escapeHtml(diff.out)}</pre>`, {
    parse_mode: "HTML",
    ...reviewKeyboard(lang, id),
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
  const lang = langForChat(chatId);
  // Callback shape is `git:<action>:<reviewId>`. Resolve the id to the repo the
  // diff was rendered against, so the action never targets the current session
  // cwd (which may have changed) or, after a restart, an unknown tree.
  const parts = parseCallback(data, "git:", 2);
  if (!parts) return "";
  const [action, id] = parts;
  if (!isHexId(id)) return t("git_review_expired", lang);
  const review = reviews.get(id);
  if (!review) return t("git_review_expired", lang);
  const cwd = review.cwd;

  if (action === "discard") {
    if (messageId !== undefined) {
      await tg.editMessageReplyMarkup(
        chatId,
        messageId,
        undefined,
        confirmDiscardKeyboard(lang, id).reply_markup,
      ).catch(() => {});
    }
    return t("git_confirm_discard_toast", lang);
  }

  if (action === "cancel") {
    reviews.delete(id);
    if (messageId !== undefined) {
      await clearKeyboard(tg, chatId, messageId);
    }
    return t("git_cancelled", lang);
  }

  if (action === "commit") {
    reviews.delete(id);
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
    reviews.delete(id);
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
