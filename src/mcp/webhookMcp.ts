import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { listWebhookTools, toolNameFor, type WebhookParam, type WebhookToolDef } from "../core/webhookTools.js";
import { resolveSecret } from "../core/vault.js";
import { safeFetch, BlockedUrlError } from "../core/safeUrl.js";
import { log } from "../logger.js";

/**
 * Turns user-registered webhook definitions (`core/webhookTools.ts`) into live
 * MCP tools. Each enabled definition becomes one tool; the agent supplies the
 * declared params and the tool issues the HTTP request through `safeFetch`
 * (SSRF-guarded). Header values that are `vault:<id>` references are resolved at
 * call time so secrets never reach the model.
 *
 * `buildWebhookMcp()` returns a single MCP server (named `webhook`) bundling
 * every enabled tool, ready to spread into a `runTurn` `mcpServers` map. Returns
 * `undefined` when no enabled tools exist, so callers can spread conditionally.
 */

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

/** Build the zod input schema for one definition from its declared params. */
function schemaFor(def: WebhookToolDef): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of def.params) {
    let field: z.ZodTypeAny = z.string();
    if (p.description) field = (field as z.ZodString).describe(p.description);
    if (!p.required) field = field.optional();
    shape[p.name] = field;
  }
  return shape;
}

/** Resolve a header value, expanding `vault:<id>` references. */
function resolveHeaderValue(v: string): string {
  return v.startsWith("vault:") ? resolveSecret(v) : v;
}

/** Apply the agent-supplied args to the request per each param's `in` location. */
function buildRequest(def: WebhookToolDef, args: Record<string, unknown>): {
  url: string;
  init: RequestInit;
} {
  let url = def.url;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};
  const body: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(def.headers)) {
    headers[k] = resolveHeaderValue(v);
  }

  for (const p of def.params) {
    const raw = args[p.name];
    if (raw === undefined || raw === null) continue;
    const val = String(raw);
    placeParam(p, val, { setQuery: (val) => query.append(p.name, val), setHeader: (val) => { headers[p.name] = val; }, setBody: (val) => { body[p.name] = val; }, setPath: (val) => { url = url.replace(`{${p.name}}`, encodeURIComponent(val)); } });
  }

  const qs = query.toString();
  if (qs) url += (url.includes("?") ? "&" : "?") + qs;

  const init: RequestInit = { method: def.method, headers };
  if (def.method !== "GET" && def.method !== "DELETE" && Object.keys(body).length) {
    if (!headers["Content-Type"] && !headers["content-type"]) headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return { url, init };
}

function placeParam(
  p: WebhookParam,
  val: string,
  sinks: { setQuery: (v: string) => void; setHeader: (v: string) => void; setBody: (v: string) => void; setPath: (v: string) => void },
): void {
  switch (p.in) {
    case "header": return sinks.setHeader(val);
    case "body": return sinks.setBody(val);
    case "path": return sinks.setPath(val);
    case "query":
    default: return sinks.setQuery(val);
  }
}

function makeTool(def: WebhookToolDef) {
  return tool(
    toolNameFor(def),
    `${def.description} (HTTP ${def.method} ${def.url})`,
    schemaFor(def),
    async (args: Record<string, unknown>) => {
      // Reject leftover unfilled path placeholders so we never call a malformed URL.
      const { url, init } = buildRequest(def, args);
      if (/\{[a-zA-Z][a-zA-Z0-9_]*\}/.test(url)) {
        return text(`Missing required path parameter in URL: ${url}`);
      }
      try {
        const res = await safeFetch(url, init);
        const text_ = (await res.text()).slice(0, 4000);
        if (!res.ok) return text(`HTTP ${res.status} ${res.statusText}${text_ ? `: ${text_}` : ""}`);
        return text(text_ || `HTTP ${res.status} (empty body)`);
      } catch (err) {
        if (err instanceof BlockedUrlError) return text(`Blocked: ${err.message}`);
        return text(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );
}

type McpServer = ReturnType<typeof createSdkMcpServer>;

/**
 * Build the single MCP server bundling every enabled webhook tool. Returns
 * `undefined` when there are none, so callers can do
 * `...(buildWebhookMcp() ? { webhook: buildWebhookMcp() } : {})` — or use
 * {@link webhookMcps} which yields the spreadable map directly.
 */
export function buildWebhookMcp(): McpServer | undefined {
  const defs = listWebhookTools().filter((d) => d.enabled && d.url);
  if (!defs.length) return undefined;
  const tools = defs.map(makeTool);
  log.debug("Webhook tools enabled", { count: tools.length });
  return createSdkMcpServer({ name: "webhook", version: "1.0.0", tools });
}

/** Spreadable `{ webhook?: server }` map; empty when nothing is configured. */
export function webhookMcps(): Record<string, McpServer> {
  const server = buildWebhookMcp();
  return server ? { webhook: server } : {};
}
