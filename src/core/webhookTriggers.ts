import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { loadJson, saveJson } from "./jsonStore.js";
import { audit } from "./audit.js";
import { log } from "../logger.js";
import { config } from "../config.js";
import { createTask } from "./tasks.js";
import { taskDelegator } from "./taskRunner.js";
import { workers } from "./workers.js";

/**
 * Inbound webhook triggers: external services (GitHub push, Stripe event, an
 * uptime ping, a custom system) hit a public, per-trigger URL `/hook/:id` and
 * kick off an autonomous agent run. The request body is authenticated with an
 * HMAC-SHA256 signature over the raw body using the trigger's own secret, so no
 * panel token is needed (and can't be, since the caller is a third party).
 *
 * A fired trigger files a Kanban backlog card and delegates it to an autonomous
 * run (optionally as a specific Lead). That reuses the whole delegation path —
 * transcript capture, panel visibility, completion webhook, retry — instead of
 * inventing a parallel runner. The inbound payload is appended to the prompt so
 * the agent can act on it (the GitHub event JSON, the Stripe object, etc.).
 *
 * This is the INBOUND counterpart to `webhook.ts` (outbound completion POSTs).
 */

const FILE = "webhookTriggers.json";

/** Max bytes of inbound body we keep/forward into the prompt (defensive cap). */
const MAX_BODY_CHARS = 16_000;

export interface WebhookTrigger {
  id: string;
  name: string;
  /** Prompt template run when the trigger fires. The inbound body is appended. */
  prompt: string;
  /** HMAC-SHA256 signing secret (shared with the caller). Never sent to panel. */
  secret: string;
  /** Working dir for the autonomous run; defaults to WORKDIR. */
  cwd?: string;
  /** Optional Lead to run as (its persona/cwd/model). Empty = generic run. */
  leadId?: string;
  enabled: boolean;
  createdAt: number;
  lastFiredAt?: number;
  fireCount: number;
}

interface WebhookTriggerFile {
  version: 1;
  triggers: WebhookTrigger[];
}

/** Panel-safe view: the signing secret is replaced with a short hint only. */
export interface WebhookTriggerView {
  id: string;
  name: string;
  prompt: string;
  cwd?: string;
  leadId?: string;
  leadName?: string;
  enabled: boolean;
  createdAt: number;
  lastFiredAt?: number;
  fireCount: number;
  /** Last 4 chars of the secret, for "is this the key I configured?" checks. */
  secretHint: string;
  /** The public path a caller posts to. */
  path: string;
}

export interface WebhookTriggerInput {
  name: string;
  prompt: string;
  cwd?: string;
  leadId?: string;
  enabled?: boolean;
}

export interface FireResult {
  ok: boolean;
  status: number;
  error?: string;
  taskId?: string;
}

type ChangeCb = () => void;

/**
 * Store + dispatcher for inbound webhook triggers. Singleton + JSON-store
 * pattern mirroring SuggestionStore / WorkerManager.
 */
class WebhookTriggerStore {
  private items: WebhookTrigger[] = loadJson<WebhookTriggerFile>(FILE, {
    version: 1,
    triggers: [],
  }).triggers;
  private onChangeCb?: ChangeCb;

  onChange(cb: ChangeCb): void {
    this.onChangeCb = cb;
  }

  private persist(): void {
    saveJson<WebhookTriggerFile>(FILE, { version: 1, triggers: this.items });
    this.onChangeCb?.();
  }

  private toView(t: WebhookTrigger): WebhookTriggerView {
    const lead = t.leadId ? workers.get(t.leadId) : undefined;
    return {
      id: t.id,
      name: t.name,
      prompt: t.prompt,
      cwd: t.cwd,
      leadId: t.leadId,
      leadName: lead?.name,
      enabled: t.enabled,
      createdAt: t.createdAt,
      lastFiredAt: t.lastFiredAt,
      fireCount: t.fireCount,
      secretHint: t.secret.slice(-4),
      path: `/hook/${t.id}`,
    };
  }

  /** All triggers, newest first, as panel-safe views (no plaintext secret). */
  list(): WebhookTriggerView[] {
    return [...this.items].sort((a, b) => b.createdAt - a.createdAt).map((t) => this.toView(t));
  }

  get(id: string): WebhookTrigger | undefined {
    return this.items.find((t) => t.id === id);
  }

  /** Reveal a trigger's signing secret (panel "copy secret" action only). */
  reveal(id: string): string | undefined {
    return this.get(id)?.secret;
  }

  /** Create a new trigger with a freshly generated signing secret. */
  add(input: WebhookTriggerInput): WebhookTriggerView {
    const t: WebhookTrigger = {
      id: randomBytes(6).toString("hex"),
      name: (input.name || "").trim().slice(0, 80) || "Untitled trigger",
      prompt: (input.prompt || "").trim().slice(0, 4_000),
      secret: randomBytes(24).toString("hex"),
      cwd: input.cwd?.trim() || undefined,
      leadId: this.validLeadId(input.leadId),
      enabled: input.enabled !== false,
      createdAt: Date.now(),
      fireCount: 0,
    };
    this.items.push(t);
    this.persist();
    audit("webhookTrigger.add", { id: t.id, name: t.name });
    return this.toView(t);
  }

  /** Patch a trigger's mutable fields. Returns the updated view, or undefined. */
  update(id: string, patch: Partial<WebhookTriggerInput>): WebhookTriggerView | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    if (typeof patch.name === "string") t.name = patch.name.trim().slice(0, 80) || t.name;
    if (typeof patch.prompt === "string") t.prompt = patch.prompt.trim().slice(0, 4_000);
    if (patch.cwd !== undefined) t.cwd = patch.cwd.trim() || undefined;
    if (patch.leadId !== undefined) t.leadId = this.validLeadId(patch.leadId);
    if (typeof patch.enabled === "boolean") t.enabled = patch.enabled;
    this.persist();
    audit("webhookTrigger.update", { id });
    return this.toView(t);
  }

  /** Rotate the signing secret (caller must be reconfigured). New view returned. */
  rotateSecret(id: string): WebhookTriggerView | undefined {
    const t = this.get(id);
    if (!t) return undefined;
    t.secret = randomBytes(24).toString("hex");
    this.persist();
    audit("webhookTrigger.rotate", { id });
    return this.toView(t);
  }

  remove(id: string): boolean {
    const before = this.items.length;
    this.items = this.items.filter((t) => t.id !== id);
    if (this.items.length === before) return false;
    this.persist();
    audit("webhookTrigger.remove", { id });
    return true;
  }

  private validLeadId(leadId?: string): string | undefined {
    if (!leadId) return undefined;
    const w = workers.get(leadId);
    return w && w.role === "lead" ? leadId : undefined;
  }

  /**
   * Verify an inbound request and, if valid, fire the trigger. `rawBody` is the
   * exact bytes received (HMAC is computed over them); `signature` is the hex
   * digest the caller sent (e.g. GitHub's `X-Hub-Signature-256: sha256=...`,
   * with or without the `sha256=` prefix). On success a backlog card is filed
   * and delegated to an autonomous run.
   */
  fire(id: string, rawBody: string, signature: string | undefined): FireResult {
    const t = this.get(id);
    // 404 vs 401 are deliberately the same shape to a caller probing ids; we
    // only log the distinction. Disabled triggers are treated as not-found.
    if (!t || !t.enabled) return { ok: false, status: 404, error: "not found" };

    if (!signature) return { ok: false, status: 401, error: "missing signature" };
    if (!verifySignature(rawBody, signature, t.secret)) {
      log.warn("Webhook trigger signature mismatch", { id });
      return { ok: false, status: 401, error: "invalid signature" };
    }
    // Replay guard: a valid signed request is otherwise valid forever, so anyone
    // who observes one delivery (proxy logs, a leaked capture) could re-send it
    // repeatedly, each time spawning an autonomous bypassPermissions run. Reject a
    // signature we've already accepted within the window.
    if (isReplay(id, signature)) {
      log.warn("Webhook trigger replay rejected", { id });
      return { ok: false, status: 409, error: "duplicate delivery" };
    }

    const body = rawBody.slice(0, MAX_BODY_CHARS);
    const prompt = body.trim()
      ? `${t.prompt}\n\n--- Inbound webhook payload ---\n${body}`
      : t.prompt;

    const card = createTask({
      title: `Webhook: ${t.name}`,
      notes: prompt,
      column: "backlog",
      createdBy: "webhook",
    });
    const res = taskDelegator.delegate(card.id, t.leadId);

    t.lastFiredAt = Date.now();
    t.fireCount += 1;
    this.persist();
    audit("webhookTrigger.fire", { id, taskId: card.id, delegated: res.ok });
    log.info("Webhook trigger fired", { id, name: t.name, taskId: card.id });
    return { ok: true, status: 202, taskId: card.id };
  }
}

/**
 * Replay guard: remembers recently-accepted signatures (keyed per trigger) so an
 * observed signed delivery can't be re-fired repeatedly. In-memory and TTL-bounded
 * — a genuine duplicate delivery within the window is rare, and the cost of a
 * false reject (one skipped event) is far lower than an unbounded replay of
 * autonomous host-capable runs.
 */
const REPLAY_TTL_MS = 10 * 60 * 1000;
const seenSignatures = new Map<string, number>();

function isReplay(id: string, signature: string): boolean {
  const norm = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const key = `${id}:${norm}`;
  const now = Date.now();
  if (seenSignatures.size > 500) {
    for (const [k, ts] of seenSignatures) if (now - ts > REPLAY_TTL_MS) seenSignatures.delete(k);
  }
  const seen = seenSignatures.get(key);
  if (seen !== undefined && now - seen < REPLAY_TTL_MS) return true;
  seenSignatures.set(key, now);
  return false;
}

/**
 * Constant-time HMAC-SHA256 verification. Accepts the digest bare or with a
 * `sha256=` prefix (GitHub style). Never throws on malformed input.
 */
function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  // Hex strings of equal length → safe to timing-compare; bail early otherwise
  // (length leak is not sensitive, both are fixed 64-char digests when valid).
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Compute the signature a caller must send for a given body + secret. Exposed so
 * the panel can show a ready-to-paste example for testing a trigger.
 */
export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export const webhookTriggers = new WebhookTriggerStore();

/** Base URL hint for assembling the public trigger URL in the panel. */
export function panelBaseHint(): string {
  const host = config.PANEL_HOST === "0.0.0.0" ? "localhost" : config.PANEL_HOST;
  return `http://${host}:${config.PANEL_PORT}`;
}
