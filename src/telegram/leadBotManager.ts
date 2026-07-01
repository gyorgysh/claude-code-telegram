import { LeadBot } from "./leadBot.js";
import { workers } from "../core/workers.js";
import { log } from "../logger.js";

/** How often the watchdog re-runs {@link LeadBotManager.sync} to catch a Lead
 *  whose long-poll died without anyone telling the manager (see below). */
const WATCHDOG_MS = 60_000;

/**
 * Owns the set of live {@link LeadBot} instances and keeps it in sync with the
 * worker registry. A Lead with a Telegram token, role "lead", and enabled is
 * "always listening": its bot long-polls Telegram and answers DMs even without
 * a specific task assigned.
 *
 * {@link sync} reconciles the running set against `workers.leads()` and is
 * idempotent, so it can be called on boot and on every registry mutation
 * (create/update/delete) to bring Leads online/offline live, no restart needed.
 *
 * A Lead's Telegraf `launch()` can end on its own — most notably a 409
 * Conflict when a second `getUpdates` poller grabs the same token — without
 * the worker registry changing at all. `sync()` alone would never notice
 * (its "already running" check just sees the stale map entry and skips it),
 * so a periodic watchdog re-runs `sync()`, and `sync()` itself now treats a
 * `!bot.isRunning()` entry the same as a missing one: drop it and let the
 * normal "start bots for desired Leads" pass bring it back. A dead entry with
 * a turn still mid-flight (its poll died, but a message handler that was
 * already running keeps going independently of polling) is left alone for
 * one more tick rather than dropped immediately — replacing it would spin up
 * a second SessionManager over the same state file while the old one is
 * still mid-write.
 */
export class LeadBotManager {
  private bots = new Map<string, { bot: LeadBot; tokenRef: string }>();
  private watchdogTimer?: NodeJS.Timeout;

  /** Reconcile the running Lead bots against the current registry. */
  async sync(): Promise<void> {
    const desired = workers.leads();

    // Stop bots that are no longer desired, whose token changed (a token
    // change needs a fresh Telegraf instance to take effect), or whose
    // long-poll already died on its own — dropping the entry here is what
    // lets the "start" pass below revive it.
    for (const [id, entry] of [...this.bots]) {
      const lead = desired.find((w) => w.id === id);
      const dead = !entry.bot.isRunning();
      if (!lead || lead.telegramToken !== entry.tokenRef) {
        try {
          entry.bot.stop("SIGTERM");
        } catch (err) {
          log.error("Lead bot stop failed", { leadId: id, error: String(err) });
        }
        this.bots.delete(id);
      } else if (dead && entry.bot.hasActiveTurn()) {
        log.warn("Lead bot polling died but a turn is still in flight — deferring restart", {
          leadId: id,
        });
      } else if (dead) {
        log.warn("Lead bot polling died — restarting", { leadId: id });
        this.bots.delete(id);
      }
    }

    // Start bots for desired Leads not currently running.
    for (const lead of desired) {
      if (this.bots.has(lead.id)) continue;
      try {
        const bot = new LeadBot(lead);
        await bot.start();
        this.bots.set(lead.id, { bot, tokenRef: lead.telegramToken! });
      } catch (err) {
        // One bad token (e.g. 401 from Telegram) must not block the others.
        log.error("Lead bot start failed", { leadId: lead.id, error: String(err) });
      }
    }
  }

  /** Force one Lead's bot to restart right now (panel "restart" action) — stops
   *  the current instance if any, unconditionally, then re-syncs to bring a
   *  fresh one up. Returns false if the Lead isn't a live-listening Lead. */
  async restartOne(leadId: string): Promise<boolean> {
    const entry = this.bots.get(leadId);
    if (entry) {
      try {
        entry.bot.stop("SIGTERM");
      } catch (err) {
        log.error("Lead bot stop failed", { leadId, error: String(err) });
      }
      this.bots.delete(leadId);
    }
    await this.sync();
    return this.bots.has(leadId);
  }

  /** Begin the periodic dead-Lead watchdog (idempotent). */
  startWatchdog(): void {
    if (this.watchdogTimer) return;
    this.watchdogTimer = setInterval(() => void this.sync(), WATCHDOG_MS);
    this.watchdogTimer.unref?.();
  }

  /** Stop the watchdog (used on shutdown). */
  stopWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = undefined;
  }

  /** Stop every running Lead bot (used on shutdown). */
  stopAll(signal: "SIGINT" | "SIGTERM"): void {
    for (const { bot } of this.bots.values()) {
      try {
        bot.stop(signal);
      } catch {
        // best-effort
      }
    }
    this.bots.clear();
  }
}

export const leadBots = new LeadBotManager();
