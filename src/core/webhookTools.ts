import { randomBytes } from "node:crypto";
import { loadJson, saveJson } from "./jsonStore.js";
import { audit } from "./audit.js";

/**
 * Generic outbound-webhook connector. Unlike the hard-wired connectors in
 * `core/connectors.ts` (Notion, Gmail, …) this lets the user register an
 * **arbitrary HTTP endpoint** in the panel and have it surface to the agent as
 * a callable MCP tool. Each definition becomes one tool named
 * `webhook_<slug>`; the agent fills in `query`/`params`/`body` and the tool
 * issues the request through `safeFetch` (SSRF-guarded, see `safeUrl.ts`).
 *
 * Definitions live in `webhookTools.json`. A definition may reference a vault
 * secret (`vault:<id>`) for an auth header value, so tokens never sit in this
 * file in plaintext.
 */

const FILE = "webhookTools.json";

/** Where a parameter value is injected into the outgoing request. */
export type WebhookParamIn = "query" | "header" | "body" | "path";

export interface WebhookParam {
  /** Parameter name the agent fills in (also the placeholder `{name}` in the path). */
  name: string;
  in: WebhookParamIn;
  description?: string;
  required?: boolean;
}

export interface WebhookToolDef {
  id: string;
  /** Human name; the tool slug is derived from this. */
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Full URL; may contain `{param}` placeholders filled from `path` params. */
  url: string;
  params: WebhookParam[];
  /**
   * Static headers sent on every call. Values may be `vault:<id>` references,
   * resolved at call time (so an `Authorization` header can hold a secret).
   */
  headers: Record<string, string>;
  enabled: boolean;
  createdAt: number;
}

interface WebhookFile {
  version: 1;
  tools: WebhookToolDef[];
}

function load(): WebhookToolDef[] {
  const f = loadJson<WebhookFile>(FILE, { version: 1, tools: [] });
  return Array.isArray(f.tools) ? f.tools : [];
}

function persist(tools: WebhookToolDef[]): void {
  saveJson<WebhookFile>(FILE, { version: 1, tools });
}

function newId(): string {
  return randomBytes(6).toString("hex");
}

/**
 * Derive the MCP tool name from a human name: lowercased, non-alphanumerics to
 * underscores, prefixed `webhook_`. Tool names must be stable + collision-free,
 * so a short id suffix is appended.
 */
export function toolNameFor(def: Pick<WebhookToolDef, "name" | "id">): string {
  const slug = def.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "call";
  return `webhook_${slug}_${def.id}`;
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const PARAM_INS = new Set<WebhookParamIn>(["query", "header", "body", "path"]);

function sanitizeParams(raw: unknown): WebhookParam[] {
  if (!Array.isArray(raw)) return [];
  const out: WebhookParam[] = [];
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) continue;
    const pin = o.in as WebhookParamIn;
    out.push({
      name,
      in: PARAM_INS.has(pin) ? pin : "query",
      description: typeof o.description === "string" ? o.description.slice(0, 300) : undefined,
      required: o.required === true,
    });
  }
  return out;
}

function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k.trim()) continue;
    if (typeof v !== "string") continue;
    // Reject header names with CR/LF (header-injection guard).
    if (/[\r\n]/.test(k) || /[\r\n]/.test(v)) continue;
    out[k.trim()] = v;
  }
  return out;
}

export function listWebhookTools(): WebhookToolDef[] {
  return load();
}

export function getWebhookTool(id: string): WebhookToolDef | undefined {
  return load().find((t) => t.id === id);
}

export interface WebhookToolInput {
  name?: string;
  description?: string;
  method?: string;
  url?: string;
  params?: unknown;
  headers?: unknown;
  enabled?: boolean;
}

export function createWebhookTool(input: WebhookToolInput): WebhookToolDef {
  const tools = load();
  const method = (input.method ?? "GET").toUpperCase();
  const def: WebhookToolDef = {
    id: newId(),
    name: (input.name ?? "").trim() || "Untitled webhook",
    description: (input.description ?? "").trim() || "Call a custom HTTP endpoint.",
    method: METHODS.has(method) ? (method as WebhookToolDef["method"]) : "GET",
    url: (input.url ?? "").trim(),
    params: sanitizeParams(input.params),
    headers: sanitizeHeaders(input.headers),
    enabled: input.enabled !== false,
    createdAt: Date.now(),
  };
  tools.push(def);
  persist(tools);
  audit("webhook.create", { id: def.id, name: def.name, method: def.method });
  return def;
}

export function updateWebhookTool(id: string, input: WebhookToolInput): WebhookToolDef | undefined {
  const tools = load();
  const def = tools.find((t) => t.id === id);
  if (!def) return undefined;
  if (input.name !== undefined) def.name = input.name.trim() || def.name;
  if (input.description !== undefined) def.description = input.description.trim() || def.description;
  if (input.method !== undefined) {
    const m = input.method.toUpperCase();
    if (METHODS.has(m)) def.method = m as WebhookToolDef["method"];
  }
  if (input.url !== undefined) def.url = input.url.trim();
  if (input.params !== undefined) def.params = sanitizeParams(input.params);
  if (input.headers !== undefined) def.headers = sanitizeHeaders(input.headers);
  if (input.enabled !== undefined) def.enabled = input.enabled;
  persist(tools);
  audit("webhook.update", { id, name: def.name });
  return def;
}

export function deleteWebhookTool(id: string): boolean {
  const tools = load();
  const next = tools.filter((t) => t.id !== id);
  if (next.length === tools.length) return false;
  persist(next);
  audit("webhook.delete", { id });
  return true;
}
