// Small retry helper for transient failures (network blips, ECONNRESET,
// timeouts) around startup calls that would otherwise be fatal on the first
// hiccup. Not a general HTTP client wrapper — just enough for the handful of
// one-shot calls made during boot (Telegram getMe/setMyCommands).

export interface RetryOptions {
  attempts?: number; // total tries, including the first
  baseMs?: number; // initial backoff
  maxMs?: number; // backoff cap
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Return false to stop retrying immediately (e.g. auth errors). Defaults to always retry. */
  shouldRetry?: (err: unknown) => boolean;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 1000;
  const maxMs = opts.maxMs ?? 15_000;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = opts.shouldRetry ? opts.shouldRetry(err) : true;
      if (!retryable || attempt === attempts) throw err;
      const delayMs = Math.min(baseMs * 2 ** (attempt - 1), maxMs);
      opts.onRetry?.(err, attempt, delayMs);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

/** Telegraf/telegram errors carry an HTTP-ish code; 401/404 mean a bad token, not a blip. */
export function isTelegramAuthError(err: unknown): boolean {
  const code = (err as { response?: { error_code?: number }; error_code?: number } | undefined)
    ?.response?.error_code ?? (err as { error_code?: number } | undefined)?.error_code;
  return code === 401 || code === 404;
}
