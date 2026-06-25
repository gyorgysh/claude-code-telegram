import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { selfUpdate } from "../core/selfUpdate.js";

/**
 * In-process MCP server letting the agent ship its own source edits to the live
 * bot. After editing THIS project's source, the agent calls self_update; the
 * manager waits until no run is active, rebuilds, and (if the build passes and a
 * service is installed) restarts so the change takes effect. Build-gated and
 * deferred-until-idle, so it never recompiles/restarts mid-task and a broken
 * build can't brick the bot. Addressable as `mcp__self_update__self_update`.
 */
export const selfUpdateMcp = createSdkMcpServer({
  name: "self_update",
  version: "1.0.0",
  tools: [
    tool(
      "self_update",
      "Apply your own source edits to the running bot. Use this only after you " +
        "have finished editing the source of THIS project (the bot's own codebase) " +
        "and want the changes to go live. Once the current task finishes, the " +
        "project is rebuilt and, if it is installed as a service, the bot restarts. " +
        "The build is a gate: if it fails, the bot is NOT restarted and the error " +
        "is reported. Pass a short, human summary of what you changed — it is sent " +
        "to the user as the report.",
      {
        summary: z
          .string()
          .describe("Short human-readable summary of the changes, sent to the user."),
      },
      async (a) => {
        const r = selfUpdate.request(a.summary);
        return { content: [{ type: "text", text: r.message }] };
      },
    ),
  ],
});
