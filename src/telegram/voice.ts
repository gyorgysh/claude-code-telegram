import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { config } from "../config.js";
import { transcribeVosk, voskConfigured } from "./vosk.js";
import { t } from "./i18n/index.js";

/** True if voice transcription is configured for the selected provider. */
export function voiceEnabled(): boolean {
  return config.TRANSCRIBE_PROVIDER === "vosk" ? voskConfigured() : Boolean(config.OPENAI_API_KEY);
}

/** A short hint telling the operator how to enable voice for their provider. */
export function voiceSetupHint(lang?: string): string {
  return config.TRANSCRIBE_PROVIDER === "vosk"
    ? t("voice_hint_vosk", lang)
    : t("voice_hint_openai", lang);
}

/** Transcribe a voice/audio file using the configured backend (openai | vosk). */
export async function transcribeAudio(filePath: string): Promise<string> {
  return config.TRANSCRIBE_PROVIDER === "vosk"
    ? transcribeVosk(filePath)
    : transcribeOpenAI(filePath);
}

/**
 * Transcribe via an OpenAI-compatible /audio/transcriptions endpoint (OpenAI,
 * Groq, …). Telegram voice notes are OGG/Opus, which Whisper accepts directly.
 */
async function transcribeOpenAI(filePath: string): Promise<string> {
  if (!config.OPENAI_API_KEY) {
    throw new Error("Voice transcription is not configured (set OPENAI_API_KEY).");
  }

  const bytes = await readFile(filePath);
  const form = new FormData();
  form.append("model", config.TRANSCRIBE_MODEL);
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: "audio/ogg" }),
    basename(filePath),
  );

  const res = await fetch(`${config.TRANSCRIBE_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Transcription failed (HTTP ${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
