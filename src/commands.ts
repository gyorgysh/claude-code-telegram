import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Telegraf } from "telegraf";
import { config } from "./config.js";
import { sessions } from "./session/manager.js";
import { sendDiff } from "./telegram/gitFlow.js";
import * as git from "./git.js";
import { escapeHtml } from "./telegram/formatting.js";
import type { UsageStat } from "./session/store.js";
import { log } from "./logger.js";

const HELP = `🤖 <b>Claude Code over Telegram</b>

Just send a message and I'll run it through Claude Code in your working directory, streaming the reply live. Risky tools (Bash/Write/Edit) ask for your approval first.

<b>Commands</b>
/new — start a fresh conversation (clear context)
/cd &lt;path&gt; — change working directory
/pwd — show current directory
/status — show session info
/diff — review the working-tree diff, then commit or discard
/commit &lt;message&gt; — stage all changes and commit
/usage — show cost &amp; activity for this chat
/stop — abort the running request
/mode safe|auto — interactive approval (default) or autonomous
/help — this message

You can also upload files or photos and I'll save them where I can see them.`;

export function registerCommands(bot: Telegraf): void {
  bot.start(async (ctx) => {
    await ctx.replyWithHTML(HELP);
  });

  bot.help(async (ctx) => {
    await ctx.replyWithHTML(HELP);
  });

  bot.command("new", async (ctx) => {
    sessions.reset(ctx.chat.id);
    log.info("Command /new", { chatId: ctx.chat.id });
    await ctx.reply("🆕 Started a fresh conversation.");
  });

  bot.command("pwd", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    await ctx.replyWithHTML(`📂 <code>${s.cwd}</code>`);
  });

  bot.command("cd", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const arg = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!arg) {
      await ctx.reply("Usage: /cd <path>");
      return;
    }
    const target = isAbsolute(arg) ? arg : resolve(s.cwd, arg);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      await ctx.reply(`⚠️ Not a directory: ${target}`);
      return;
    }
    s.cwd = target;
    sessions.save();
    log.info("Command /cd", { chatId: ctx.chat.id, cwd: target });
    await ctx.replyWithHTML(`📂 Now in <code>${target}</code>`);
  });

  bot.command("diff", async (ctx) => {
    log.info("Command /diff", { chatId: ctx.chat.id });
    await sendDiff(ctx.telegram, ctx.chat.id);
  });

  bot.command("commit", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const message = ctx.message.text.split(/\s+/).slice(1).join(" ").trim();
    if (!message) {
      await ctx.reply("Usage: /commit <message>");
      return;
    }
    if (!(await git.isRepo(s.cwd))) {
      await ctx.reply(`⚠️ Not a git repository: ${s.cwd}`);
      return;
    }
    const res = await git.commitAll(s.cwd, message);
    log.info("Command /commit", { chatId: ctx.chat.id, ok: res.ok });
    await ctx.replyWithHTML(
      res.ok
        ? `✅ Committed.\n<pre>${escapeHtml(res.out)}</pre>`
        : `⚠️ Commit failed.\n<pre>${escapeHtml(res.out)}</pre>`,
    );
  });

  bot.command("usage", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const today = new Date().toISOString().slice(0, 10);
    const day = s.usage.daily[today];
    await ctx.replyWithHTML(
      `<b>📊 Usage — this chat</b>\n` +
        `Today: ${fmtUsage(day)}\n` +
        `Lifetime: ${fmtUsage(s.usage.total)}`,
    );
  });

  bot.command("status", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    await ctx.replyWithHTML(
      `<b>Status</b>\n` +
        `📂 <code>${s.cwd}</code>\n` +
        `🧠 model: <code>${config.CLAUDE_MODEL}</code>\n` +
        `🔒 mode: <b>${s.mode}</b>\n` +
        `🔗 session: <code>${s.sessionId ?? "(new)"}</code>\n` +
        `⚙️ ${s.busy ? "running…" : "idle"}`,
    );
  });

  bot.command("stop", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    if (s.busy && s.abort) {
      s.abort.abort();
      log.info("Command /stop — aborting turn", { chatId: ctx.chat.id });
      await ctx.reply("⏹ Stopping…");
    } else {
      await ctx.reply("Nothing is running.");
    }
  });

  bot.command("mode", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const arg = ctx.message.text.split(/\s+/)[1]?.toLowerCase();
    if (arg === "safe" || arg === "auto") {
      s.mode = arg;
      sessions.save();
      log.info("Command /mode", { chatId: ctx.chat.id, mode: arg });
      await ctx.reply(
        arg === "auto"
          ? "⚠️ Autonomous mode: tools run without approval."
          : "🔒 Safe mode: risky tools require approval.",
      );
    } else {
      await ctx.reply(`Current mode: ${s.mode}. Usage: /mode safe|auto`);
    }
  });
}

/** Render a usage bucket as "N turns · $X.XX · Ym Ns" (handles the empty case). */
function fmtUsage(stat: UsageStat | undefined): string {
  if (!stat || stat.turns === 0) return "—";
  const secs = Math.round(stat.durationMs / 1000);
  const time = secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`;
  return `${stat.turns} turn${stat.turns === 1 ? "" : "s"} · $${stat.costUsd.toFixed(2)} · ${time}`;
}
