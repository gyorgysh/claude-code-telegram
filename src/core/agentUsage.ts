/**
 * Per-agent token/cost usage tracking.
 *
 * Records a cumulative UsageStat per named agent (Atlas, Iris, Ethan, task
 * delegations, etc.) and persists to agentUsage.json in the data dir. The
 * store is in-memory during a run and flushed on every mutation (debounced).
 */
import { zeroStat, type UsageStat } from "../session/store.js";
import { loadJson, saveJson } from "./jsonStore.js";
import type { TurnUsage } from "../session/manager.js";

const FILE = "agentUsage.json";

export type AgentRole = "atlas" | "lead" | "worker" | "task";

export interface AgentUsageEntry {
  /** Display name: "Atlas", the Lead's name, worker's name, or "Tasks". */
  name: string;
  role: AgentRole;
  total: UsageStat;
}

interface StoreFile {
  version: 1;
  agents: AgentUsageEntry[];
}

function add(into: UsageStat, u: TurnUsage): void {
  into.turns += 1;
  into.costUsd += u.costUsd;
  into.durationMs += u.durationMs;
  into.inputTokens += u.inputTokens;
  into.outputTokens += u.outputTokens;
  into.cacheReadTokens += u.cacheReadTokens;
  into.cacheWriteTokens += u.cacheWriteTokens;
}

class AgentUsageStore {
  private agents: AgentUsageEntry[] = loadJson<StoreFile>(FILE, {
    version: 1,
    agents: [],
  }).agents;

  private debounce?: ReturnType<typeof setTimeout>;

  private flush(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      saveJson<StoreFile>(FILE, { version: 1, agents: this.agents });
    }, 500);
  }

  record(name: string, role: AgentRole, u: TurnUsage): void {
    let entry = this.agents.find((a) => a.name === name);
    if (!entry) {
      entry = { name, role, total: zeroStat() };
      this.agents.push(entry);
    }
    entry.role = role; // keep role in sync if it changes
    add(entry.total, u);
    this.flush();
  }

  list(): AgentUsageEntry[] {
    return [...this.agents].sort((a, b) => b.total.inputTokens + b.total.outputTokens - (a.total.inputTokens + a.total.outputTokens));
  }

  /** Flush synchronously on shutdown. */
  flushSync(): void {
    if (this.debounce) {
      clearTimeout(this.debounce);
      this.debounce = undefined;
    }
    saveJson<StoreFile>(FILE, { version: 1, agents: this.agents });
  }
}

export const agentUsage = new AgentUsageStore();
