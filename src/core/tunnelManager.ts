/**
 * TunnelManager — a singleton that exposes the local panel to the internet by
 * spawning a tunnel relay (ngrok or cloudflared) as a child process pointed at
 * the panel's loopback port. It captures the public URL from the relay's output
 * and streams status to all panel WebSocket clients.
 *
 * Same posture as ptyManager: a panel-token holder gets host-equivalent access,
 * and a public URL widens the attack surface, so the whole feature is gated by
 * PANEL_TUNNEL_ENABLED (off by default) and the relay only runs when the user
 * explicitly starts it from the Remote Access view.
 *
 * The relay binaries (`ngrok`, `cloudflared`) are NOT bundled; they must already
 * be installed on the host. If the binary is missing, start() reports an error
 * the panel surfaces as a "install the CLI" hint.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { config } from "../config.js";
import { log } from "../logger.js";
import { loadJson, saveJson } from "./jsonStore.js";
import { resolveSecret } from "./vault.js";

const STORE = "tunnel.json";

export type TunnelProviderId = "ngrok" | "cloudflare";
export type TunnelState = "stopped" | "starting" | "running" | "error";

/** Persisted configuration for the remote-access tunnel. */
interface TunnelConfig {
  provider: TunnelProviderId;
  /** Auth token (plain or a `vault:<id>` reference). Optional for cloudflare quick tunnels. */
  authToken?: string;
  /** Optional reserved domain/hostname (paid ngrok / named cloudflare tunnel). */
  domain?: string;
}

const DEFAULTS: TunnelConfig = { provider: "ngrok", authToken: "", domain: "" };

type BroadcastFn = (msg: unknown) => void;

/** A line-matcher that pulls the public https URL out of a relay's stdout/stderr. */
interface ProviderSpec {
  /** Build the argv for the relay, given the local port + resolved token/domain. */
  command(port: number, token: string | undefined, domain: string | undefined): { cmd: string; args: string[]; env: NodeJS.ProcessEnv };
  /** Try to extract a public URL from a single output line. */
  matchUrl(line: string): string | undefined;
}

const PROVIDERS: Record<TunnelProviderId, ProviderSpec> = {
  ngrok: {
    command(port, token, domain) {
      // `ngrok http <port>` writes the public URL to its log stream. We force
      // structured logging to stdout so it's parseable without the agent API.
      const args = ["http", String(port), "--log", "stdout", "--log-format", "logfmt"];
      if (domain) args.push("--domain", domain);
      const env = { ...process.env } as NodeJS.ProcessEnv;
      // Pass the authtoken via env so it never appears in the process args.
      if (token) env.NGROK_AUTHTOKEN = token;
      return { cmd: "ngrok", args, env };
    },
    matchUrl(line) {
      // logfmt line carries `url=https://xxxx.ngrok-free.app`.
      const m = line.match(/url=(https:\/\/[^\s"]+)/);
      return m?.[1];
    },
  },
  cloudflare: {
    command(port, _token, domain) {
      // Quick tunnel: `cloudflared tunnel --url http://localhost:<port>` prints a
      // trycloudflare.com URL. A named tunnel (domain) uses `run <name>` and the
      // hostname is configured in the cloudflare dashboard, so we just surface it.
      if (domain) {
        return { cmd: "cloudflared", args: ["tunnel", "run", domain], env: { ...process.env } };
      }
      return {
        cmd: "cloudflared",
        args: ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
        env: { ...process.env },
      };
    },
    matchUrl(line) {
      const m = line.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i);
      return m?.[1];
    },
  },
};

export interface TunnelView {
  /** Whether the feature is unlocked (PANEL_TUNNEL_ENABLED). */
  enabled: boolean;
  state: TunnelState;
  provider: TunnelProviderId;
  /** True when a token is configured (the plaintext is never returned). */
  hasToken: boolean;
  domain: string;
  /** The public URL once the relay is up. */
  url?: string;
  error?: string;
  startedAt?: number;
}

export class TunnelManager {
  private broadcast: BroadcastFn = () => {};
  private cfg: TunnelConfig = { ...DEFAULTS };
  private proc: ChildProcess | null = null;
  private state: TunnelState = "stopped";
  private url: string | undefined;
  private error: string | undefined;
  private startedAt: number | undefined;

  start(broadcast: BroadcastFn): void {
    this.broadcast = broadcast;
    this.cfg = { ...DEFAULTS, ...loadJson<Partial<TunnelConfig>>(STORE, {}) };
    if (!config.PANEL_TUNNEL_ENABLED) {
      log.info("[tunnel] remote access disabled (PANEL_TUNNEL_ENABLED=false)");
    }
  }

  get enabled(): boolean {
    return config.PANEL_TUNNEL_ENABLED;
  }

  view(): TunnelView {
    return {
      enabled: this.enabled,
      state: this.state,
      provider: this.cfg.provider,
      hasToken: Boolean(this.cfg.authToken && this.cfg.authToken.trim()),
      domain: this.cfg.domain ?? "",
      url: this.url,
      error: this.error,
      startedAt: this.startedAt,
    };
  }

  /** Persist config (provider / token / domain). A blank token keeps the existing one. */
  setConfig(patch: Partial<TunnelConfig>): TunnelView {
    if (patch.provider === "ngrok" || patch.provider === "cloudflare") {
      this.cfg.provider = patch.provider;
    }
    if (typeof patch.domain === "string") this.cfg.domain = patch.domain.trim();
    // A blank token means "leave the saved one alone" (matches the providers UX).
    if (typeof patch.authToken === "string" && patch.authToken.trim()) {
      this.cfg.authToken = patch.authToken.trim();
    }
    saveJson(STORE, this.cfg);
    return this.view();
  }

  /** Launch the relay. Returns the (initial) view; the URL arrives asynchronously. */
  start_relay(): { ok: true } | { ok: false; error: string } {
    if (!this.enabled) return { ok: false, error: "remote access disabled" };
    if (this.proc) return { ok: false, error: "already running" };

    const port = config.PANEL_PORT;
    const spec = PROVIDERS[this.cfg.provider];
    const token = this.cfg.authToken ? resolveSecret(this.cfg.authToken) : undefined;
    if (this.cfg.provider === "ngrok" && !token) {
      return { ok: false, error: "ngrok needs an auth token (get one from ngrok.com)" };
    }
    const domain = this.cfg.domain || undefined;
    const { cmd, args, env } = spec.command(port, token, domain);

    log.info("[tunnel] starting relay", { provider: this.cfg.provider, cmd, port });
    this.error = undefined;
    this.url = undefined;
    this.setState("starting");

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      const msg = `failed to launch ${cmd}: ${(e as Error).message}`;
      this.fail(msg);
      return { ok: false, error: msg };
    }
    this.proc = proc;
    this.startedAt = Date.now();

    const onLine = (line: string) => {
      const url = spec.matchUrl(line);
      if (url && !this.url) {
        this.url = url;
        this.setState("running");
        log.info("[tunnel] public URL up", { url });
      }
    };
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) onLine(line);
    };
    proc.stdout?.on("data", feed);
    proc.stderr?.on("data", feed);

    proc.on("error", (e) => {
      // ENOENT = binary not installed.
      const msg =
        (e as NodeJS.ErrnoException).code === "ENOENT"
          ? `${cmd} is not installed on the host — install it first`
          : `${cmd} error: ${e.message}`;
      this.fail(msg);
    });
    proc.on("exit", (code) => {
      // A clean stop() nulls the proc first, so this only fires on an unexpected exit.
      if (this.proc === proc) {
        if (this.state !== "error") {
          this.fail(code === 0 ? "relay exited" : `relay exited with code ${code}`);
        }
        this.proc = null;
      }
    });

    return { ok: true };
  }

  /** Stop the relay and reset to stopped. */
  stop(): void {
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try { proc.kill("SIGTERM"); } catch { /* already gone */ }
    }
    this.url = undefined;
    this.startedAt = undefined;
    this.error = undefined;
    this.setState("stopped");
  }

  /** Kill on shutdown without broadcasting (process is exiting). */
  kill(): void {
    if (this.proc) {
      try { this.proc.kill("SIGTERM"); } catch { /* ignore */ }
      this.proc = null;
    }
  }

  private fail(error: string): void {
    this.error = error;
    log.warn("[tunnel] " + error);
    this.setState("error");
  }

  private setState(state: TunnelState): void {
    this.state = state;
    try {
      this.broadcast({ type: "tunnel", view: this.view() });
    } catch { /* no clients */ }
  }
}

export const tunnelManager = new TunnelManager();
