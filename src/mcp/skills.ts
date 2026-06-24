import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { listSkills, createSkill, updateSkill } from "../core/skills.js";

function findByName(name: string) {
  const want = name.trim().toLowerCase();
  return listSkills().find((s) => s.name.toLowerCase() === want);
}

/**
 * In-process MCP server letting the agent distil reusable procedures into the
 * skills library ("skill factory"): save a new skill or replace one by name,
 * append to an existing one, or list what exists. Backs the same store the
 * panel Skills view edits and that workers attach as a persona. Tools
 * `mcp__skills__skill_{save,patch,list}`, auto-allowed.
 */
export const skillsMcp = createSdkMcpServer({
  name: "skills",
  version: "1.0.0",
  tools: [
    tool(
      "skill_save",
      "Save a reusable skill (a named, self-contained instruction for a recurring " +
        "task). If one with the same name exists it is replaced. Use this when you " +
        "work out a procedure worth reusing later.",
      {
        name: z.string().describe("Short, unique skill name."),
        prompt: z.string().describe("The reusable instruction body."),
        description: z.string().optional().describe("One-line summary."),
        cwd: z.string().optional().describe("Default working directory when run."),
      },
      async (a) => {
        const existing = findByName(a.name);
        const s = existing
          ? updateSkill(existing.id, { name: a.name, prompt: a.prompt, description: a.description, cwd: a.cwd })
          : createSkill(a);
        return { content: [{ type: "text", text: `${existing ? "Updated" : "Saved"} skill "${a.name}" (id ${s?.id}).` }] };
      },
    ),
    tool(
      "skill_patch",
      "Append text to an existing skill (by name), refining it without rewriting. " +
        "Creates the skill if it doesn't exist yet.",
      {
        name: z.string(),
        append: z.string().describe("Text to add to the end of the skill body."),
      },
      async (a) => {
        const existing = findByName(a.name);
        if (existing) {
          updateSkill(existing.id, { prompt: `${existing.prompt}\n\n${a.append}` });
          return { content: [{ type: "text", text: `Patched skill "${a.name}".` }] };
        }
        const s = createSkill({ name: a.name, prompt: a.append });
        return { content: [{ type: "text", text: `Created skill "${a.name}" (id ${s.id}).` }] };
      },
    ),
    tool(
      "skill_list",
      "List saved skills (name + description).",
      {},
      async () => {
        const skills = listSkills();
        const text = skills.length
          ? skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`).join("\n")
          : "No skills saved yet.";
        return { content: [{ type: "text", text }] };
      },
    ),
  ],
});
