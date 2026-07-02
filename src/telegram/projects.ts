import { existsSync, statSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { Markup, type Telegram } from "telegraf";
import { sessions, type Session } from "../session/manager.js";
import { log } from "../logger.js";
import { escapeHtml } from "./formatting.js";
import { CALLBACK_MAX_BYTES } from "./callback.js";
import { t, langForChat } from "./i18n/index.js";

/** Stable short id for a project path. Buttons key on this instead of the array
 *  index so a list that changed since the menu was rendered (a removal from
 *  another /projects message, a panel edit) can't make a press target the wrong
 *  directory. */
function projHash(dir: string): string {
  return createHash("sha256").update(dir).digest("hex").slice(0, 12);
}

/** Build the projects keyboard: one row per saved dir (switch + remove), plus add. */
function projectsKeyboard(s: Session, lang: string) {
  const rows = s.projects.map((dir) => {
    const here = dir === s.cwd ? "✓ " : "";
    const h = projHash(dir);
    return [
      Markup.button.callback(`${here}📂 ${basename(dir) || dir}`, `proj:go:${h}`),
      Markup.button.callback(t("proj_remove_btn", lang), `proj:rm:${h}`),
    ];
  });
  const saved = s.projects.includes(s.cwd);
  rows.push([
    Markup.button.callback(
      saved ? t("proj_save_another", lang) : t("proj_save_current", lang),
      "proj:add",
    ),
  ]);
  return Markup.inlineKeyboard(rows);
}

/** Reply to /projects with the switch menu. */
export async function sendProjectsMenu(tg: Telegram, chatId: number): Promise<void> {
  const s = sessions.get(chatId);
  const lang = langForChat(chatId);
  const header = t("proj_header", lang);
  const body =
    s.projects.length === 0
      ? `${header}\n\n${t("proj_empty", lang)}`
      : `${header}\n\n${t("proj_current", lang, { cwd: escapeHtml(s.cwd) })}`;
  await tg.sendMessage(chatId, body, { parse_mode: "HTML", ...projectsKeyboard(s, lang) });
}

export function isProjectCallback(data: string): boolean {
  return data.startsWith("proj:");
}

/** Resolve a /projects button press; returns a short toast for answerCbQuery. */
export async function resolveProjectCallback(
  tg: Telegram,
  chatId: number,
  data: string,
  messageId: number | undefined,
): Promise<string> {
  // Validate structure: "proj:add" (2 parts) or "proj:go|rm:<hash>" (3 parts).
  if (Buffer.byteLength(data, "utf8") > CALLBACK_MAX_BYTES) return "";
  const segs = data.split(":");
  if (segs.length < 2 || segs.length > 3) return "";
  const [, action, hash] = segs;
  const s = sessions.get(chatId);
  const lang = langForChat(chatId);
  // Resolve by content hash, not array position, so the target is exactly the dir
  // the button was rendered for even if the list changed meanwhile.
  const dir = hash ? s.projects.find((d) => projHash(d) === hash) : undefined;
  let toast = "";

  if (action === "add") {
    if (s.projects.includes(s.cwd)) {
      toast = t("proj_already_saved", lang);
    } else {
      s.projects.push(s.cwd);
      sessions.save();
      log.info("Project saved", { chatId, cwd: s.cwd });
      toast = t("proj_saved", lang, { name: basename(s.cwd) });
    }
  } else if (action === "rm" && dir) {
    s.projects = s.projects.filter((d) => d !== dir);
    sessions.save();
    log.info("Project removed", { chatId, dir });
    toast = t("proj_removed", lang, { name: basename(dir) });
  } else if (action === "go" && dir) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return t("proj_gone", lang);
    }
    s.cwd = dir;
    sessions.save();
    log.info("Project switched", { chatId, cwd: dir });
    toast = t("proj_now_in", lang, { name: basename(dir) });
  } else {
    return "";
  }

  // Re-render the menu in place to reflect the change.
  if (messageId !== undefined) {
    await tg
      .editMessageReplyMarkup(chatId, messageId, undefined, projectsKeyboard(s, lang).reply_markup)
      .catch(() => {});
  }
  return toast;
}
