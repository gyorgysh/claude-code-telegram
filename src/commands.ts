import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Telegraf } from "telegraf";
import { mainSettingsView } from "./core/mainSettings.js";
import { sessions } from "./session/manager.js";
import { sendDiff } from "./telegram/gitFlow.js";
import { sendProjectsMenu } from "./telegram/projects.js";
import { schedules, parseWhen, describeSpec } from "./schedule/manager.js";
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
/projects — saved working dirs, switch between them
/diff — review the working-tree diff, then commit or discard
/commit &lt;message&gt; — stage all changes and commit
/usage — show cost &amp; activity for this chat
/allow &lt;Tool&gt; · /allowed · /disallow — manage always-allow rules
/schedule — run a prompt on a timer (e.g. <code>/schedule add 2h | check disk</code>)
/stop — abort the running request
/mode safe|auto — interactive approval (default) or autonomous
/help — this message

You can also upload files or photos (I can see images), or send a voice note.`;

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

  bot.command("projects", async (ctx) => {
    log.info("Command /projects", { chatId: ctx.chat.id });
    await sendProjectsMenu(ctx.telegram, ctx.chat.id);
  });

  bot.command("allow", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const tool = ctx.message.text.split(/\s+/)[1];
    if (!tool) {
      await ctx.reply("Usage: /allow <Tool>  (e.g. /allow Bash, /allow Write)");
      return;
    }
    s.sessionAllowedTools.add(tool);
    sessions.save();
    log.info("Command /allow", { chatId: ctx.chat.id, tool });
    await ctx.replyWithHTML(`♾️ Always allowing <b>${escapeHtml(tool)}</b> (no prompt).`);
  });

  bot.command("disallow", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const arg = ctx.message.text.split(/\s+/)[1];
    if (!arg) {
      await ctx.reply("Usage: /disallow <Tool|all>");
      return;
    }
    if (arg === "all") {
      s.sessionAllowedTools.clear();
      s.allowedBashCmds.clear();
      sessions.save();
      await ctx.reply("🔒 Cleared all always-allow rules. Tools will prompt again.");
      return;
    }
    const had = s.sessionAllowedTools.delete(arg) || s.allowedBashCmds.delete(arg);
    sessions.save();
    log.info("Command /disallow", { chatId: ctx.chat.id, arg, had });
    await ctx.replyWithHTML(
      had ? `🔒 Removed <b>${escapeHtml(arg)}</b> from always-allow.` : `Not in the allow-list: ${escapeHtml(arg)}`,
    );
  });

  bot.command("allowed", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const tools = [...s.sessionAllowedTools];
    const cmds = [...s.allowedBashCmds];
    if (tools.length === 0 && cmds.length === 0) {
      await ctx.replyWithHTML(
        "No always-allow rules. Risky tools prompt every time (safe mode).\n" +
          "Add one with <code>/allow &lt;Tool&gt;</code> or the “Always allow” buttons.",
      );
      return;
    }
    await ctx.replyWithHTML(
      `<b>♾️ Always allowed (no prompt)</b>\n` +
        (tools.length ? `Tools: ${tools.map((t) => `<code>${escapeHtml(t)}</code>`).join(", ")}\n` : "") +
        (cmds.length ? `Bash: ${cmds.map((c) => `<code>${escapeHtml(c)}</code>`).join(", ")}\n` : "") +
        `\nClear with <code>/disallow &lt;name&gt;</code> or <code>/disallow all</code>.`,
    );
  });

  bot.command("schedule", async (ctx) => {
    const s = sessions.get(ctx.chat.id);
    const raw = ctx.message.text.replace(/^\/schedule(@\S+)?\s*/, "");
    const [sub, ...rest] = raw.split(/\s+/);

    // /schedule  | /schedule list
    if (!sub || sub === "list") {
      const list = schedules.list(ctx.chat.id);
      if (list.length === 0) {
        await ctx.replyWithHTML(
          "No schedules. Add one:\n" +
            "<code>/schedule add 2h | check disk space and warn if &gt;90%</code>\n" +
            "<code>/schedule add 09:00 | summarize yesterday's logs</code>",
        );
        return;
      }
      const lines = list.map(
        (x) =>
          `• <code>${x.id}</code> — ${escapeHtml(describeSpec(x.spec))}, next ${new Date(x.nextRunAt).toLocaleString()}\n  <i>${escapeHtml(x.prompt.slice(0, 80))}</i>`,
      );
      await ctx.replyWithHTML(
        `<b>⏰ Schedules</b>\n${lines.join("\n")}\n\nRemove with <code>/schedule rm &lt;id&gt;</code>.`,
      );
      return;
    }

    // /schedule rm <id>
    if (sub === "rm" || sub === "remove" || sub === "del") {
      const id = rest[0];
      if (!id) {
        await ctx.reply("Usage: /schedule rm <id>");
        return;
      }
      await ctx.reply(schedules.remove(ctx.chat.id, id) ? `🗑 Removed ${id}.` : `No schedule with id ${id}.`);
      return;
    }

    // /schedule add <when> | <prompt>
    if (sub === "add") {
      const body = rest.join(" ");
      const pipe = body.indexOf("|");
      if (pipe === -1) {
        await ctx.reply("Usage: /schedule add <when> | <prompt>\nwhen = 30m|2h|1d or HH:MM (24h, server time)");
        return;
      }
      const when = body.slice(0, pipe).trim();
      const prompt = body.slice(pipe + 1).trim();
      const spec = parseWhen(when);
      if (!spec) {
        await ctx.reply(`Couldn't parse “${when}”. Use 30m / 2h / 1d, or HH:MM (min interval 1m).`);
        return;
      }
      if (!prompt) {
        await ctx.reply("The prompt (after |) is empty.");
        return;
      }
      const sched = schedules.add(ctx.chat.id, s.cwd, prompt, spec);
      log.info("Command /schedule add", { chatId: ctx.chat.id, id: sched.id });
      await ctx.replyWithHTML(
        `⏰ Scheduled <code>${sched.id}</code> — ${escapeHtml(describeSpec(spec))}.\n` +
          `First run ${new Date(sched.nextRunAt).toLocaleString()} in <code>${escapeHtml(s.cwd)}</code>.\n` +
          `<i>Runs autonomously (no approval prompts).</i>`,
      );
      return;
    }

    await ctx.reply("Usage: /schedule [list] | /schedule add <when> | <prompt> | /schedule rm <id>");
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
        `🧠 Atlas · <code>${mainSettingsView().effectiveModel}</code>\n` +
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
