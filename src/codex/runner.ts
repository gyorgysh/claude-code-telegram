import { spawn } from "node:child_process";
import type { RunOptions, RunResult, TokenUsage } from "../claude/runner.js";
import { log } from "../logger.js";

/**
 * Drive one turn through OpenAI's `codex` CLI, spawned as a subprocess — the
 * same "wrap the provider's own agentic CLI" approach used for `claude`
 * (src/claude/runner.ts) and `grok` (src/grok/runner.js). Codex's own tool
 * belt and sandboxing run inside the subprocess.
 *
 * `codex exec --json` emits newline-delimited JSON events: `thread.started`
 * (carries the resumable session id), `item.started`/`item.completed` (a
 * `command_execution` item is a tool call — visible here, unlike the Grok
 * backend — or an `agent_message` item is the final response text, delivered
 * whole rather than as incremental deltas), and `turn.completed` (carries real
 * token usage, also unlike Grok). `codex exec resume <threadId>` continues a
 * session; unlike the first invocation it takes no `--cd`/`--sandbox` — those
 * are fixed from the original session.
 */
export async function runTurn(opts: RunOptions): Promise<RunResult> {
  const args = ["exec"];
  if (opts.resume) args.push("resume", opts.resume);
  args.push("--json", "--skip-git-repo-check");
  if (!opts.resume) {
    args.push("--cd", opts.cwd);
    // Codex has no separate interactive-approval flag in `exec` mode (it's
    // headless by nature); the sandbox tier is the only safety knob available,
    // so "default" gets a contained sandbox and "bypassPermissions" drops it.
    if (opts.permissionMode === "bypassPermissions") {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--sandbox", "workspace-write");
    }
  }
  if (opts.model) args.push("--model", opts.model);
  // Terminate flag parsing with `--` and pass the prompt as the final positional.
  // Codex is a clap CLI: without this, a prompt beginning with `-` (an ordinary
  // "- bullet" message) is rejected as an unknown flag, and text that matches a
  // real flag (e.g. `--dangerously-bypass-approvals-and-sandbox`) would be parsed
  // as one — flag injection that drops the sandbox, the only safety knob here.
  args.push("--", opts.prompt);

  interface CodexItem {
    type?: string;
    text?: string;
    command?: string;
    exit_code?: number | null;
  }
  interface CodexEvent {
    type?: string;
    thread_id?: string;
    item?: CodexItem;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cached_input_tokens?: number;
    };
  }

  const startedAt = Date.now();
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn("codex", args, {
      cwd: opts.cwd,
      signal: opts.abortController.signal,
      // stdin ignored (not piped): `codex exec` reads stdin as extra context
      // when it's available at all, and blocks waiting for EOF if left open.
      stdio: ["ignore", "pipe", "pipe"],
    });

    let buffer = "";
    let text = "";
    let gotEnd = false;
    let tokens: TokenUsage | undefined;
    const stderr: string[] = [];

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let evt: CodexEvent;
        try {
          evt = JSON.parse(line);
        } catch {
          continue; // skip malformed/non-JSON lines (e.g. the stdin-read banner)
        }
        if (evt.type === "thread.started" && evt.thread_id) {
          opts.onSessionId(evt.thread_id);
        } else if (evt.type === "item.started" && evt.item?.type === "command_execution") {
          opts.onToolUse(evt.item.type, { command: evt.item.command });
        } else if (evt.type === "item.completed") {
          const item = evt.item;
          if (item?.type === "command_execution") {
            const isError = typeof item.exit_code === "number" && item.exit_code !== 0;
            opts.onToolResult?.(isError);
          } else if (item?.type === "agent_message" && typeof item.text === "string") {
            text += item.text;
            opts.onText(item.text);
          }
        } else if (evt.type === "turn.completed") {
          gotEnd = true;
          if (evt.usage) {
            tokens = {
              inputTokens: evt.usage.input_tokens ?? 0,
              outputTokens: evt.usage.output_tokens ?? 0,
              cacheReadTokens: evt.usage.cached_input_tokens ?? 0,
              cacheWriteTokens: 0,
            };
          }
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString("utf8").trim();
      if (line) {
        stderr.push(line);
        log.debug("codex stderr", { line: line.slice(0, 500) });
      }
    });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0 && !gotEnd) {
        const tail = stderr.slice(-8).join("\n");
        reject(new Error(`codex exited with code ${code}${tail ? ` — ${tail}` : ""}`));
        return;
      }
      if (code !== 0) {
        log.warn("codex exited non-zero after a successful turn — using the captured result", { code });
      }
      resolve({ isError: false, text, durationMs: Date.now() - startedAt, tokens });
    });
  });
}
