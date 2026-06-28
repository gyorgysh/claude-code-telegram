import { Markup, type Telegram } from "telegraf";
import { suggestions, type Suggestion } from "../core/suggestions.js";
import { log } from "../logger.js";
import { escapeHtml } from "./formatting.js";
import { parseCallback, isHexId } from "./callback.js";
import { t, langForChat } from "./i18n/index.js";

type Row = ReturnType<typeof Markup.button.callback>[];

/** One block of HTML per pending suggestion + its action rows. */
function renderItem(s: Suggestion, lang: string): { text: string; rows: Row[] } {
  const cat = s.category ? ` <i>[${escapeHtml(s.category)}]</i>` : "";
  const text =
    `• <b>${escapeHtml(s.title)}</b>${cat}\n` +
    `  <i>${escapeHtml(s.fromAgentName)}</i> · <code>${s.id}</code>`;
  return {
    text,
    rows: [
      [
        Markup.button.callback(t("inbox_park_btn", lang), `inbox:${s.id}:acc`),
        Markup.button.callback(t("inbox_delegate_btn", lang), `inbox:${s.id}:del`),
        Markup.button.callback(t("inbox_dismiss_btn", lang), `inbox:${s.id}:dis`),
      ],
      [Markup.button.callback(t("inbox_details_btn", lang), `inbox:${s.id}:det`)],
    ],
  };
}

/** Build the full digest body + keyboard from the pending queue. */
function buildDigest(lang: string): { body: string; keyboard: ReturnType<typeof Markup.inlineKeyboard> } {
  const header = t("inbox_header", lang);
  const pending = suggestions.pending();
  if (pending.length === 0) {
    return {
      body: `${header}\n\n${t("inbox_empty", lang)}`,
      keyboard: Markup.inlineKeyboard([]),
    };
  }
  const blocks = pending.map((s) => renderItem(s, lang));
  const body =
    `${header}\n${pending.length} pending. ` +
    `${t("inbox_instructions", lang)}\n\n` +
    blocks.map((b) => b.text).join("\n\n");
  return { body, keyboard: Markup.inlineKeyboard(blocks.flatMap((b) => b.rows)) };
}

/** Reply to /inbox with the pending suggestion digest. */
export async function sendInbox(tg: Telegram, chatId: number): Promise<void> {
  const { body, keyboard } = buildDigest(langForChat(chatId));
  await tg.sendMessage(chatId, body, { parse_mode: "HTML", ...keyboard });
}

export function isInboxCallback(data: string): boolean {
  return data.startsWith("inbox:");
}

/** Resolve an /inbox button press; returns a short toast for answerCbQuery. */
export async function resolveInboxCallback(
  tg: Telegram,
  chatId: number,
  data: string,
  messageId: number | undefined,
): Promise<string> {
  const lang = langForChat(chatId);
  const parts = parseCallback(data, "inbox:", 2);
  if (!parts) return t("inbox_gone", lang);
  const [id, action] = parts;
  if (!isHexId(id)) return t("inbox_gone", lang);
  const s = suggestions.get(id);
  if (!s) return t("inbox_gone", lang);

  let toast = "";
  if (action === "det") {
    // Reply with the full detail text; don't touch the digest.
    const cat = s.category
      ? t("inbox_details_category", lang, { category: escapeHtml(s.category) })
      : "";
    await tg
      .sendMessage(
        chatId,
        t("inbox_details", lang, {
          title: escapeHtml(s.title),
          agent: escapeHtml(s.fromAgentName),
          category: cat,
          detail: escapeHtml(s.detail),
        }),
        { parse_mode: "HTML" },
      )
      .catch(() => {});
    return t("inbox_details_posted", lang);
  } else if (action === "acc") {
    const updated = suggestions.accept(id);
    if (updated?.status === "accepted") {
      log.info("Suggestion parked", { id, taskId: updated.taskId });
      toast = t("inbox_parked", lang);
    } else {
      toast = t("inbox_already_decided", lang);
    }
  } else if (action === "del") {
    const { suggestion, leadName, started } = suggestions.delegate(id);
    if (started && suggestion) {
      const who = leadName ?? t("inbox_generic_run", lang);
      log.info("Suggestion delegated", { id, taskId: suggestion.taskId, leadName });
      await tg
        .sendMessage(
          chatId,
          t("inbox_delegated", lang, {
            title: escapeHtml(suggestion.title),
            who: escapeHtml(who),
          }),
          { parse_mode: "HTML" },
        )
        .catch(() => {});
      toast = leadName
        ? t("inbox_delegated_toast", lang, { lead: leadName })
        : t("inbox_delegated_toast_plain", lang);
    } else {
      toast = suggestion ? t("inbox_delegate_failed", lang) : t("inbox_gone", lang);
    }
  } else if (action === "dis") {
    const updated = suggestions.dismiss(id);
    toast = updated?.status === "dismissed" ? t("inbox_dismissed", lang) : t("inbox_already_decided", lang);
  } else {
    return "";
  }

  // Re-render the digest in place so the decided item drops off.
  if (messageId !== undefined) {
    const { body, keyboard } = buildDigest(lang);
    await tg
      .editMessageText(chatId, messageId, undefined, body, {
        parse_mode: "HTML",
        ...keyboard,
      })
      .catch(() => {});
  }
  return toast;
}
