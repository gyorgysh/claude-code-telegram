import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config.js";
import { authMiddleware } from "./auth.js";
import { registerCommands } from "./commands.js";
import { AUTO_ALLOWED_TOOLS, runTurn, type PermissionResult } from "./claude/runner.js";
import { createTelegramMcp } from "./mcp/sendFile.js";
import { TelegramStreamer, type Streamer } from "./telegram/streamer.js";
import { DraftStreamer } from "./telegram/draftStreamer.js";
import { RichDraftStreamer } from "./telegram/richDraftStreamer.js";
import { PermissionManager } from "./telegram/permissions.js";
import { downloadIncomingFile, isViewableImage, readImageInput } from "./telegram/files.js";
import { isGitCallback, resolveGitCallback } from "./telegram/gitFlow.js";
import { escapeHtml } from "./telegram/formatting.js";
import type { ImageInput } from "./claude/runner.js";
import { sessions } from "./session/manager.js";
import { log, preview } from "./logger.js";

export function buildBot(): Telegraf {
  const bot = new Telegraf(config.TELEGRAM_BOT_TOKEN);
  const permissions = new PermissionManager(bot.telegram);

  bot.use(authMiddleware);
  registerCommands(bot);

  // --- Tool-approval button presses ---
  bot.on("callback_query", async (ctx) => {
    const data =
      "data" in ctx.callbackQuery ? (ctx.callbackQuery.data as string) : undefined;
    if (data && permissions.isApprovalCallback(data)) {
      log.debug("Approval button pressed", { chatId: ctx.chat?.id, data });
      const toast = await permissions.resolve(data);
      await ctx.answerCbQuery(toast.slice(0, 200)).catch(() => {});
    } else if (data && isGitCallback(data) && ctx.chat) {
      log.debug("Git button pressed", { chatId: ctx.chat.id, data });
      const messageId = ctx.callbackQuery.message?.message_id;
      const toast = await resolveGitCallback(ctx.telegram, ctx.chat.id, data, messageId);
      await ctx.answerCbQuery(toast.slice(0, 200)).catch(() => {});
    } else {
      await ctx.answerCbQuery().catch(() => {});
    }
  });

  // --- Incoming files ---
  bot.on(message("document"), async (ctx) => {
    const doc = ctx.message.document;
    const session = sessions.get(ctx.chat.id);
    try {
      const path = await downloadIncomingFile(
        ctx.telegram,
        doc.file_id,
        doc.file_name ?? `file_${doc.file_unique_id}`,
        session.cwd,
      );
      log.info("File received", { chatId: ctx.chat.id, name: doc.file_name, path });
      const caption = ctx.message.caption?.trim();
      const prompt = caption
        ? `${caption}\n\n(The user uploaded a file, saved at: ${path})`
        : `The user uploaded a file, saved at: ${path}. Take a look.`;
      // Image documents are shown to the model inline; everything else by path.
      const images = isViewableImage(path) ? await imageInputs(path) : undefined;
      // Fire-and-forget: must NOT block the polling loop, or approval button
      // presses can never be fetched (Telegraf awaits handlers before getUpdates).
      void runUserPrompt(permissions, ctx.chat.id, prompt, ctx.telegram, images);
    } catch (err) {
      log.error("File download failed", { chatId: ctx.chat.id, error: errText(err) });
      await ctx.reply(`⚠️ Could not download file: ${errText(err)}`);
    }
  });

  bot.on(message("photo"), async (ctx) => {
    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1];
    const session = sessions.get(ctx.chat.id);
    try {
      const path = await downloadIncomingFile(
        ctx.telegram,
        largest.file_id,
        `photo_${largest.file_unique_id}.jpg`,
        session.cwd,
      );
      log.info("Photo received", { chatId: ctx.chat.id, path });
      const caption = ctx.message.caption?.trim();
      const prompt = caption
        ? `${caption}\n\n(The user sent an image, also saved at: ${path})`
        : `The user sent this image (also saved at: ${path}).`;
      void runUserPrompt(permissions, ctx.chat.id, prompt, ctx.telegram, await imageInputs(path));
    } catch (err) {
      log.error("Photo download failed", { chatId: ctx.chat.id, error: errText(err) });
      await ctx.reply(`⚠️ Could not download image: ${errText(err)}`);
    }
  });

  // --- Plain text prompts ---
  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return; // handled by command handlers
    void runUserPrompt(permissions, ctx.chat.id, text, ctx.telegram);
  });

  bot.catch((err, ctx) => {
    log.error("Unhandled bot error", { updateType: ctx.updateType, error: errText(err) });
  });

  return bot;
}

/**
 * Fire-and-forget wrapper around handleUserPrompt. The Telegram update handler
 * must return promptly so the long-polling loop keeps fetching updates (notably
 * approval button presses); the actual turn runs detached here. Guards against
 * unhandled rejections since no caller awaits it.
 */
function runUserPrompt(
  permissions: PermissionManager,
  chatId: number,
  prompt: string,
  tg: Telegraf["telegram"],
  images?: ImageInput[],
): void {
  handleUserPrompt(permissions, chatId, prompt, tg, images).catch((err) => {
    const session = sessions.get(chatId);
    session.busy = false;
    session.abort = undefined;
    void tg.sendMessage(chatId, friendlyError(err)).catch(() => {});
    log.error("Turn failed", { chatId, error: errText(err) });
  });
}

/** Run a single Claude Code turn for a chat, streaming output back live. */
async function handleUserPrompt(
  permissions: PermissionManager,
  chatId: number,
  prompt: string,
  tg: Telegraf["telegram"],
  images?: ImageInput[],
): Promise<void> {
  const session = sessions.get(chatId);
  if (session.busy) {
    log.info("Prompt rejected — chat busy", { chatId });
    await tg.sendMessage(chatId, "⏳ Still working on the previous request. Send /stop to cancel.");
    return;
  }

  log.info("Prompt received", {
    chatId,
    mode: session.mode,
    resume: Boolean(session.sessionId),
    cwd: session.cwd,
    text: preview(prompt),
  });
  const startedAt = Date.now();

  session.busy = true;
  session.abort = new AbortController();

  // rich/draft modes stream a native ephemeral preview; edit mode uses a
  // throttled placeholder message.
  let streamer: Streamer;
  if (config.STREAM_MODE === "rich") {
    const draft = new RichDraftStreamer(tg, chatId);
    await draft.start();
    streamer = draft;
  } else if (config.STREAM_MODE === "draft") {
    const draft = new DraftStreamer(tg, chatId);
    await draft.start();
    streamer = draft;
  } else {
    const placeholder = await tg.sendMessage(chatId, "🤔 Thinking…");
    streamer = new TelegramStreamer(tg, chatId, placeholder.message_id);
  }

  // Native "typing…" indicator for the whole turn (it expires after ~5s, so
  // refresh it). Runs in every mode, including before the first streamed token.
  await tg.sendChatAction(chatId, "typing").catch(() => {});
  const typing = setInterval(() => {
    void tg.sendChatAction(chatId, "typing").catch(() => {});
  }, 4000);

  const canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<PermissionResult> => {
    if (AUTO_ALLOWED_TOOLS.has(toolName) || session.sessionAllowedTools.has(toolName)) {
      log.debug("Tool auto-allowed", { chatId, tool: toolName });
      return { behavior: "allow", updatedInput: input };
    }
    log.info("Approval requested", { chatId, tool: toolName });
    const choice = await permissions.request(chatId, toolName, input);
    log.info("Approval resolved", { chatId, tool: toolName, choice });
    if (choice === "always") {
      session.sessionAllowedTools.add(toolName);
      return { behavior: "allow", updatedInput: input };
    }
    if (choice === "allow") return { behavior: "allow", updatedInput: input };
    return { behavior: "deny", message: "User denied this action." };
  };

  try {
    const res = await runTurn({
      prompt,
      images,
      cwd: session.cwd,
      resume: session.sessionId,
      permissionMode: session.mode === "auto" ? "bypassPermissions" : "default",
      abortController: session.abort,
      mcpServers: { telegram: createTelegramMcp(tg, chatId, session.cwd) },
      canUseTool,
      onText: (delta) => streamer.appendText(delta),
      onToolUse: (name, input) => {
        log.info("Tool use", { chatId, tool: name, arg: preview(summarizeArg(input), 80) });
        streamer.setStatus(`🔧 <i>${name}</i> ${summarizeInput(input)}`);
      },
      onSessionId: (id) => {
        log.debug("Session id", { chatId, sessionId: id });
        session.sessionId = id;
      },
    });

    // Timing is still tracked (logged below), just no longer shown in the reply.
    await streamer.finalize();
    sessions.recordUsage(chatId, res.costUsd ?? 0, res.durationMs ?? 0);
    log.info("Turn complete", {
      chatId,
      ms: Date.now() - startedAt,
      sdkMs: res.durationMs ?? null,
      isError: res.isError,
      chars: res.text?.length ?? 0,
    });
  } catch (err) {
    // Flush whatever streamed so far, then send the notice as its own message —
    // finalize() drops empty content, so an early failure would otherwise be silent.
    await streamer.finalize().catch(() => {});
    if (session.abort?.signal.aborted) {
      log.info("Turn stopped by user", { chatId, ms: Date.now() - startedAt });
      await tg.sendMessage(chatId, "⏹ Stopped.").catch(() => {});
    } else {
      log.error("Turn errored", { chatId, ms: Date.now() - startedAt, error: errText(err) });
      await tg.sendMessage(chatId, friendlyError(err)).catch(() => {});
    }
  } finally {
    clearInterval(typing);
    session.busy = false;
    session.abort = undefined;
  }
}

/** Read a saved image into the inline-vision payload; undefined if unreadable. */
async function imageInputs(path: string): Promise<ImageInput[] | undefined> {
  try {
    const img = await readImageInput(path);
    return img ? [img] : undefined;
  } catch (err) {
    log.error("Failed to read image for vision", { path, error: errText(err) });
    return undefined;
  }
}

/** Raw, log-friendly summary of a tool's most relevant argument. */
function summarizeArg(input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  return String(obj.command ?? obj.file_path ?? obj.pattern ?? obj.path ?? "");
}

function summarizeInput(input: unknown): string {
  const s = summarizeArg(input);
  return s ? `<code>${escapeHtml(s.slice(0, 80))}</code>` : "";
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Turn a raw SDK/CLI error into a clear notice for the admin. The raw text now
 * includes the CLI's stderr tail (see runner.ts), so usage/credit/auth issues
 * are matchable and surfaced plainly instead of "process exited with code 1".
 */
function friendlyError(err: unknown): string {
  const raw = errText(err);
  const low = raw.toLowerCase();
  if (/\b429\b|rate.?limit/.test(low)) {
    return "⏳ Rate limited by the API. Give it a moment and try again.";
  }
  if (/credit balance|insufficient|out of credit|quota|usage limit|limit reached|too low/.test(low)) {
    return "💳 Usage limit / credits exhausted. Top up or wait for the limit to reset, then retry.";
  }
  if (/\b529\b|overloaded/.test(low)) {
    return "🌀 The API is overloaded right now. Try again shortly.";
  }
  if (/\b401\b|unauthorized|authentication|invalid.{0,12}api.?key|oauth|not logged in|login/.test(low)) {
    return "🔑 Authentication failed. Check ANTHROPIC_API_KEY or re-run the `claude` CLI login, then restart.";
  }
  if (/abort/.test(low)) return "⏹ Stopped.";
  const detail = raw.length > 600 ? raw.slice(0, 600) + "…" : raw;
  return `⚠️ That action failed.\n\n${detail}`;
}
