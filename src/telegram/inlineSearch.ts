import type { Context } from "telegraf";
import type { InlineQueryResult } from "telegraf/types";
import { allowedUserIds } from "../config.js";
import { listTasks } from "../core/tasks.js";
import { listSkills } from "../core/skills.js";
import { memory } from "../core/memory.js";
import { semanticSearch, type SearchItem } from "../core/semanticSearch.js";
import { log } from "../logger.js";

/**
 * Inline-mode search over the operator's own tasks, skills, and memories.
 *
 * Typing `@thebot query` in any chat surfaces matching cards/skills/facts; the
 * picked result pastes a plain-text snippet the operator can send as context.
 * Results are ranked with the shared hybrid semanticSearch (embeddings when
 * available, keyword fallback otherwise).
 *
 * Auth: inline queries carry no chat, so the normal chat-scoped authMiddleware
 * can't vet them (and silently drops them). We gate here on the user-id
 * allow-list directly — an unknown user gets an empty result set, never data.
 */

const CACHE_SECONDS = 5;
const PER_KIND = 8;

type Kind = "task" | "skill" | "memory";

interface Candidate extends SearchItem {
  kind: Kind;
  title: string;
  body: string;
}

/** Truncate to a Telegram-friendly length without cutting mid-word too harshly. */
function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : flat.slice(0, n - 1).trimEnd() + "…";
}

/** Gather the searchable candidate set across all three stores. */
function gatherCandidates(): Candidate[] {
  const out: Candidate[] = [];

  for (const task of listTasks()) {
    out.push({
      id: `task:${task.id}`,
      kind: "task",
      title: task.title,
      body: task.notes,
      text: `${task.title} ${task.notes}`,
    });
  }

  for (const skill of listSkills()) {
    out.push({
      id: `skill:${skill.id}`,
      kind: "skill",
      title: skill.name,
      body: skill.description || skill.prompt,
      text: `${skill.name} ${skill.description} ${skill.prompt}`,
    });
  }

  for (const m of memory.list()) {
    out.push({
      id: `memory:${m.id}`,
      kind: "memory",
      title: clip(m.text, 60),
      body: m.tags.length ? m.tags.join(", ") : m.text,
      text: `${m.text} ${m.tags.join(" ")}`,
    });
  }

  return out;
}

const KIND_EMOJI: Record<Kind, string> = { task: "🗂", skill: "🛠", memory: "🧠" };
const KIND_LABEL: Record<Kind, string> = { task: "Task", skill: "Skill", memory: "Memory" };

/** The text pasted into the chat when a result is chosen. */
function messageFor(c: Candidate): string {
  const header = `${KIND_EMOJI[c.kind]} ${KIND_LABEL[c.kind]}: ${c.title}`;
  const body = c.body && c.body !== c.title ? `\n${clip(c.body, 600)}` : "";
  return header + body;
}

/**
 * Build inline results for a query. With no query, returns a few recent items
 * of each kind so the menu isn't empty. Ranked, capped, and mapped to article
 * results whose chosen message is a plain-text snippet.
 */
export async function buildInlineResults(query: string): Promise<InlineQueryResult[]> {
  const candidates = gatherCandidates();
  if (candidates.length === 0) return [];

  let ranked: Candidate[];
  if (query.trim()) {
    const hits = await semanticSearch(candidates, query, PER_KIND * 3);
    ranked = hits.map((h) => h.item);
  } else {
    // Empty query: show a small mixed sample so the picker has content.
    const byKind: Record<Kind, Candidate[]> = { task: [], skill: [], memory: [] };
    for (const c of candidates) if (byKind[c.kind].length < 4) byKind[c.kind].push(c);
    ranked = [...byKind.task, ...byKind.skill, ...byKind.memory];
  }

  return ranked.slice(0, 24).map((c) => ({
    type: "article",
    id: c.id,
    title: `${KIND_EMOJI[c.kind]} ${clip(c.title, 60)}`,
    description: clip(c.body || KIND_LABEL[c.kind], 80),
    input_message_content: { message_text: messageFor(c) },
  }));
}

/** Answer an inline_query update, gated on the user-id allow-list. */
export async function handleInlineQuery(ctx: Context): Promise<void> {
  const inline = ctx.inlineQuery;
  if (!inline) return;
  const userId = ctx.from?.id;
  if (userId === undefined || !allowedUserIds.has(userId)) {
    // Unknown user: return nothing rather than leak the operator's data.
    await ctx.answerInlineQuery([], { cache_time: CACHE_SECONDS, is_personal: true }).catch(() => {});
    return;
  }
  try {
    const results = await buildInlineResults(inline.query);
    await ctx.answerInlineQuery(results, { cache_time: CACHE_SECONDS, is_personal: true });
  } catch (err) {
    log.warn("Inline query failed", { error: err instanceof Error ? err.message : String(err) });
    // Empty results with no explanation just look like "no matches" to the
    // user. Surface a visible notice instead via the switch-to-PM button,
    // the only text Telegram lets an inline answer carry on failure.
    await ctx
      .answerInlineQuery([], {
        cache_time: 0,
        is_personal: true,
        button: { text: "⚠️ Search failed, tap to open chat", start_parameter: "inline_search_failed" },
      })
      .catch(() => {});
  }
}
