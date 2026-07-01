import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { listConnectors } from "../core/connectors.js";
import { dataPath } from "../core/jsonStore.js";
import { generateImage, ImageGenError } from "../core/imageGen.js";
import { log } from "../logger.js";

/**
 * Image-generation MCP tools, one per enabled image connector (Recraft,
 * Ideogram, Replicate, fal.ai, local Automatic1111-compatible servers). Kept
 * deliberately separate from `buildConnectorMcps()` (connectorsMcp.ts): these
 * tools spend real money per call (or hit a local resource), so unlike the
 * read-only connector tools they are never auto-allowed and never
 * scope-gated (there's no read/write distinction for "generate an image").
 * `buildImageGenMcps()` is spread into `mcpServers` alongside
 * `buildConnectorMcps()` at the same three run sites.
 */

type McpServer = ReturnType<typeof createSdkMcpServer>;

function connectorIsEnabled(id: string): boolean {
  return listConnectors().find((x) => x.id === id)?.enabled ?? false;
}

function successResult(image: Awaited<ReturnType<typeof generateImage>>) {
  const fullPath = dataPath(image.path);
  return {
    content: [
      {
        type: "text" as const,
        text: `Generated image saved to the Gallery (id: ${image.id}) at ${fullPath}. Call send_file with this path to also deliver it to the user's chat.`,
      },
    ],
  };
}

function errorResult(providerId: string, err: unknown) {
  const msg = err instanceof ImageGenError ? err.message : String(err);
  log.error("Image generation failed", { provider: providerId, error: msg });
  return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
}

/** Simple providers: fixed prompt/size/style shape (Recraft, Ideogram). */
function simpleImageProviderMcp(providerId: "recraft" | "ideogram", label: string): McpServer {
  return createSdkMcpServer({
    name: providerId,
    version: "1.0.0",
    tools: [
      tool(
        `${providerId}_generate_image`,
        `Generate an image with ${label} from a text prompt. This calls a paid API — costs ` +
          "real money per call. The image is saved to the Gallery; call send_file with the " +
          "returned path to also deliver it straight to the user's chat.",
        {
          prompt: z.string().describe("Text description of the image to generate."),
          size: z.string().optional().describe("Optional size / aspect-ratio hint (provider-specific)."),
          style: z.string().optional().describe("Optional style preset (provider-specific)."),
        },
        async (args) => {
          try {
            const image = await generateImage({ providerId, prompt: args.prompt, size: args.size, style: args.style });
            return successResult(image);
          } catch (err) {
            return errorResult(providerId, err);
          }
        },
      ),
    ],
  });
}

/** Gateway providers: model id + prompt + optional raw JSON passthrough (Replicate, fal.ai). */
function gatewayImageProviderMcp(providerId: "replicate" | "fal", label: string): McpServer {
  return createSdkMcpServer({
    name: providerId,
    version: "1.0.0",
    tools: [
      tool(
        `${providerId}_generate_image`,
        `Generate an image with ${label} from a text prompt and a model id (e.g. "black-forest-labs/flux-schnell"). ` +
          "This calls a paid API — costs real money per call. The image is saved to the Gallery; call send_file " +
          "with the returned path to also deliver it straight to the user's chat.",
        {
          model: z.string().describe(`The ${label} model id to run, e.g. "black-forest-labs/flux-schnell".`),
          prompt: z.string().describe("Text description of the image to generate."),
          extraInput: z
            .record(z.unknown())
            .optional()
            .describe("Optional raw extra fields merged into the model's input payload (e.g. width, num_inference_steps, lora_weights)."),
        },
        async (args) => {
          try {
            const image = await generateImage({
              providerId,
              model: args.model,
              prompt: args.prompt,
              extraInput: args.extraInput,
            });
            return successResult(image);
          } catch (err) {
            return errorResult(providerId, err);
          }
        },
      ),
    ],
  });
}

/** Local Automatic1111-compatible server: prompt + negative prompt + size + steps, no cost. */
function localSdMcp(): McpServer {
  return createSdkMcpServer({
    name: "local_sd",
    version: "1.0.0",
    tools: [
      tool(
        "local_sd_generate_image",
        "Generate an image through the configured local Automatic1111-compatible server (A1111/SD.Next/Forge). " +
          "No cloud cost, but uses local GPU/CPU resources. The image is saved to the Gallery; call send_file " +
          "with the returned path to also deliver it straight to the user's chat.",
        {
          prompt: z.string().describe("Text description of the image to generate."),
          negativePrompt: z.string().optional().describe("Optional negative prompt (things to avoid)."),
          size: z.string().optional().describe('Optional "WIDTHxHEIGHT", e.g. "1024x1024". Defaults to 1024x1024.'),
          steps: z.number().optional().describe("Optional sampling steps. Defaults to 20."),
        },
        async (args) => {
          try {
            const image = await generateImage({
              providerId: "local_sd",
              prompt: args.prompt,
              negativePrompt: args.negativePrompt,
              size: args.size,
              steps: args.steps,
            });
            return successResult(image);
          } catch (err) {
            return errorResult("local_sd", err);
          }
        },
      ),
    ],
  });
}

/** Build MCP servers for currently enabled image-generation connectors. Empty when none are configured. */
export function buildImageGenMcps(): Record<string, McpServer> {
  const out: Record<string, McpServer> = {};
  if (connectorIsEnabled("recraft")) out.recraft = simpleImageProviderMcp("recraft", "Recraft");
  if (connectorIsEnabled("ideogram")) out.ideogram = simpleImageProviderMcp("ideogram", "Ideogram");
  if (connectorIsEnabled("replicate")) out.replicate = gatewayImageProviderMcp("replicate", "Replicate");
  if (connectorIsEnabled("fal")) out.fal = gatewayImageProviderMcp("fal", "fal.ai");
  if (connectorIsEnabled("local_sd")) out.local_sd = localSdMcp();
  return out;
}
