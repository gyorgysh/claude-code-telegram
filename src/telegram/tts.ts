import { spawn } from "node:child_process";
import type { Telegram } from "telegraf";
import { config } from "../config.js";
import { log } from "../logger.js";

/** True if text-to-speech is configured for the selected provider. */
export function ttsEnabled(): boolean {
  return config.TTS_PROVIDER === "piper"
    ? Boolean(config.PIPER_MODEL)
    : Boolean(config.OPENAI_API_KEY);
}

/** A short hint telling the operator how to enable spoken replies. */
export function ttsSetupHint(): string {
  return config.TTS_PROVIDER === "piper"
    ? "Set PIPER_PATH + PIPER_MODEL (a local .onnx voice) to enable spoken replies."
    : "Set OPENAI_API_KEY (and TTS_VOICE/TTS_MODEL) to enable spoken replies.";
}

/**
 * Telegram voice messages must be OGG/Opus. OpenAI's /audio/speech can return
 * Opus directly; Piper emits WAV, which we leave as-is (Telegram accepts it as
 * an audio document, but a voice note needs Opus — so Piper output is sent via
 * sendAudio, while OpenAI output is sent as a true voice note). The caller picks
 * the send method from `format`.
 */
export interface SpeechResult {
  audio: Buffer;
  /** "ogg" → Telegram voice note (sendVoice); "wav" → audio file (sendAudio). */
  format: "ogg" | "wav";
}

/** Synthesize speech for `text` using the configured backend (openai | piper). */
export async function synthesizeSpeech(text: string): Promise<SpeechResult> {
  const clipped = text.slice(0, TTS_MAX_CHARS).trim();
  if (!clipped) throw new Error("Nothing to speak.");
  return config.TTS_PROVIDER === "piper"
    ? { audio: await synthesizePiper(clipped), format: "wav" }
    : { audio: await synthesizeOpenAI(clipped), format: "ogg" };
}

/** Cap how much text we send to TTS so a long reply doesn't run for minutes. */
const TTS_MAX_CHARS = 2000;

/** Synthesize via an OpenAI-compatible /audio/speech endpoint, returning Opus. */
async function synthesizeOpenAI(text: string): Promise<Buffer> {
  if (!config.OPENAI_API_KEY) {
    throw new Error("Text-to-speech is not configured (set OPENAI_API_KEY).");
  }
  const res = await fetch(`${config.TTS_BASE_URL}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.TTS_MODEL,
      voice: config.TTS_VOICE,
      input: text,
      response_format: "opus",
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Speech synthesis failed (HTTP ${res.status}): ${detail}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Synthesize via a local Piper binary, returning WAV bytes on stdout. */
function synthesizePiper(text: string): Promise<Buffer> {
  if (!config.PIPER_MODEL) {
    throw new Error("Local TTS is not configured (set PIPER_MODEL).");
  }
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      config.PIPER_PATH,
      ["--model", config.PIPER_MODEL!, "--output_file", "-"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        log.warn("Piper TTS exited non-zero", { code, stderr: stderr.slice(0, 300) });
        reject(new Error(`Piper exited with code ${code}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.write(text);
    child.stdin.end();
  });
}

/**
 * Reduce a markdown reply to plain text suitable for speaking: drop code blocks,
 * inline-code/formatting markers, links (keep the label), list bullets, and the
 * "---" log delimiter, then collapse whitespace.
 */
export function speechText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links/images → label
    .replace(/^[ \t]*[-*+]\s+/gm, "") // list bullets
    .replace(/^>\s?/gm, "") // blockquotes
    .replace(/[*_#~]/g, "") // bold/italic/heading/strike markers
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Synthesize `markdown` and deliver it to `chatId` as a spoken message. OpenAI
 * Opus output is sent as a true Telegram voice note; Piper WAV goes as an audio
 * file. Best-effort: logs and swallows any failure so a TTS hiccup never breaks
 * the (already-sent) text reply.
 */
export async function sendVoiceReply(tg: Telegram, chatId: number, markdown: string): Promise<void> {
  const spoken = speechText(markdown);
  if (!spoken) return;
  try {
    const { audio, format } = await synthesizeSpeech(spoken);
    if (format === "ogg") {
      await tg.sendVoice(chatId, { source: audio });
    } else {
      await tg.sendAudio(chatId, { source: audio, filename: "reply.wav" });
    }
  } catch (err) {
    log.warn("Voice reply failed", { chatId, error: err instanceof Error ? err.message : String(err) });
  }
}
