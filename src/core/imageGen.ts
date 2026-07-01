/**
 * Shared image-generation core. Resolves a connector's vault credential, calls
 * that provider's REST API, downloads the (time-limited) result URL or
 * decodes an inline base64 result, and persists the bytes via gallery.ts.
 * Both the MCP tool (imageGenMcp.ts) and the panel's Gallery "Generate"
 * composer call this one function — no duplicated provider logic.
 */

import { listConnectors } from "./connectors.js";
import { resolveSecret } from "./vault.js";
import { saveGeneratedImage, type GalleryImage } from "./gallery.js";
import { log } from "../logger.js";

export class ImageGenError extends Error {}

export type ImageProviderId = "recraft" | "ideogram" | "replicate" | "fal" | "local_sd";

/** Resolve the live, enabled credential (API key or URL) for an image connector id, or undefined. */
function credentialFor(id: string): string | undefined {
  const c = listConnectors().find((x) => x.id === id);
  if (!c || !c.enabled || !c.secretId) return undefined;
  const token = resolveSecret(c.secretId);
  return token || undefined;
}

/** Either a downloadable result URL, or bytes already decoded (e.g. inline base64). */
type GenResult = { kind: "url"; url: string } | { kind: "bytes"; bytes: Buffer; ext: string };

async function recraftGenerate(apiKey: string, prompt: string, size?: string, style?: string): Promise<GenResult> {
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, style: style || undefined, size: size || undefined, n: 1 }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ImageGenError(`Recraft API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: Array<{ url?: string }> };
  const url = json.data?.[0]?.url;
  if (!url) throw new ImageGenError("Recraft response had no image url");
  return { kind: "url", url };
}

async function ideogramGenerate(apiKey: string, prompt: string, size?: string, style?: string): Promise<GenResult> {
  const res = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", {
    method: "POST",
    headers: { "Api-Key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspect_ratio: size || undefined,
      style_preset: style || undefined,
      num_images: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ImageGenError(`Ideogram API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: Array<{ url?: string }> };
  const url = json.data?.[0]?.url;
  if (!url) throw new ImageGenError("Ideogram response had no image url");
  return { kind: "url", url };
}

interface ReplicatePrediction {
  id: string;
  status: string;
  output?: unknown;
  urls?: { get?: string };
  error?: unknown;
}

async function replicateGenerate(
  apiKey: string,
  model: string,
  prompt: string,
  extraInput?: Record<string, unknown>,
): Promise<GenResult> {
  const input = { prompt, ...(extraInput ?? {}) };
  const isOwnerName = model.includes("/");
  const url = isOwnerName
    ? `https://api.replicate.com/v1/models/${model}/predictions`
    : "https://api.replicate.com/v1/predictions";
  const body = isOwnerName ? { input } : { version: model, input };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      Prefer: "wait=60",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImageGenError(`Replicate API error ${res.status}: ${text.slice(0, 300)}`);
  }
  let prediction = (await res.json()) as ReplicatePrediction;

  const getUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`;
  const deadline = Date.now() + 180_000;
  while (prediction.status !== "succeeded" && prediction.status !== "failed" && prediction.status !== "canceled") {
    if (Date.now() > deadline) throw new ImageGenError("Replicate prediction timed out after 180s");
    await new Promise((r) => setTimeout(r, 1500));
    const pollRes = await fetch(getUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!pollRes.ok) throw new ImageGenError(`Replicate poll error ${pollRes.status}`);
    prediction = (await pollRes.json()) as ReplicatePrediction;
  }
  if (prediction.status !== "succeeded") {
    throw new ImageGenError(`Replicate prediction ${prediction.status}: ${JSON.stringify(prediction.error ?? "")}`);
  }
  const out = prediction.output;
  const resultUrl = Array.isArray(out) ? out[0] : out;
  if (typeof resultUrl !== "string") throw new ImageGenError("Replicate response had no output url");
  return { kind: "url", url: resultUrl };
}

async function falGenerate(apiKey: string, model: string, prompt: string, extraInput?: Record<string, unknown>): Promise<GenResult> {
  const res = await fetch(`https://fal.run/${model}`, {
    method: "POST",
    headers: { Authorization: `Key ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt, ...(extraInput ?? {}) }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImageGenError(`fal.ai API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { images?: Array<{ url?: string }>; image?: { url?: string } };
  const url = json.images?.[0]?.url ?? json.image?.url;
  if (!url) throw new ImageGenError("fal.ai response had no image url");
  return { kind: "url", url };
}

async function localSdGenerate(
  baseUrl: string,
  prompt: string,
  negativePrompt?: string,
  size?: string,
  steps?: number,
): Promise<GenResult> {
  const [wStr, hStr] = (size ?? "1024x1024").split("x");
  const width = Number(wStr) || 1024;
  const height = Number(hStr) || 1024;
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/sdapi/v1/txt2img`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt,
      negative_prompt: negativePrompt || undefined,
      width,
      height,
      steps: steps ?? 20,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ImageGenError(`Local SD server error ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { images?: string[] };
  const b64 = json.images?.[0];
  if (!b64) throw new ImageGenError("Local SD server returned no image");
  return { kind: "bytes", bytes: Buffer.from(b64, "base64"), ext: "png" };
}

async function downloadImage(url: string): Promise<{ bytes: Buffer; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new ImageGenError(`Failed to download generated image: HTTP ${res.status}`);
  const arrayBuf = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "";
  const ext = contentType.includes("svg")
    ? "svg"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("jpeg")
        ? "jpg"
        : "png";
  return { bytes: Buffer.from(arrayBuf), ext };
}

export interface GenerateImageInput {
  providerId: ImageProviderId;
  prompt: string;
  size?: string;
  style?: string;
  /** Model id, required for the replicate/fal gateway connectors (e.g. "black-forest-labs/flux-schnell"). */
  model?: string;
  /** Negative prompt, used by local_sd. */
  negativePrompt?: string;
  /** Sampling steps, used by local_sd. */
  steps?: number;
  /** Raw passthrough merged into the replicate/fal request input, for power users. */
  extraInput?: Record<string, unknown>;
  sourceChat?: number;
}

/** Generate an image through a configured connector and persist it to the gallery. */
export async function generateImage(input: GenerateImageInput): Promise<GalleryImage> {
  const credential = credentialFor(input.providerId);
  if (!credential) throw new ImageGenError(`${input.providerId} connector is not enabled or has no credential set`);

  const prompt = input.prompt.trim();
  if (!prompt) throw new ImageGenError("prompt is required");

  let result: GenResult;
  if (input.providerId === "recraft") {
    result = await recraftGenerate(credential, prompt, input.size, input.style);
  } else if (input.providerId === "ideogram") {
    result = await ideogramGenerate(credential, prompt, input.size, input.style);
  } else if (input.providerId === "replicate") {
    if (!input.model) throw new ImageGenError("model is required for the Replicate connector");
    result = await replicateGenerate(credential, input.model, prompt, input.extraInput);
  } else if (input.providerId === "fal") {
    if (!input.model) throw new ImageGenError("model is required for the fal.ai connector");
    result = await falGenerate(credential, input.model, prompt, input.extraInput);
  } else if (input.providerId === "local_sd") {
    result = await localSdGenerate(credential, prompt, input.negativePrompt, input.size, input.steps);
  } else {
    throw new ImageGenError(`Unknown image provider: ${input.providerId}`);
  }

  const { bytes, ext } = result.kind === "url" ? await downloadImage(result.url) : result;
  const image = saveGeneratedImage({
    provider: input.providerId,
    prompt,
    bytes,
    ext,
    sourceChat: input.sourceChat,
  });
  log.info("Generated image", { provider: input.providerId, id: image.id, bytes: bytes.length });
  return image;
}
