export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 409 || status >= 500;
}

export function isRetryableError(err: any): boolean {
  if (!err) return false;
  const status = err.status ?? err.statusCode;
  if (typeof status === 'number') {
    return isRetryableStatus(status);
  }
  const match = /status code (\d{3})/.exec(String(err.message ?? ''));
  if (match) {
    return isRetryableStatus(Number(match[1]));
  }
  const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND'];
  if (typeof err.code === 'string' && transientCodes.includes(err.code)) return true;
  return /fetch failed|network|socket hang up|connection error|terminated/i.test(String(err.message ?? ''));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (err: any, nextAttempt: number, delayMs: number) => void;
}

// Exponential backoff capped at maxDelayMs, with ±25% jitter so a fleet of
// concurrent agents that hits a shared 429 does not retry in lockstep.
export function retryDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
  return Math.round(exponential * (0.75 + Math.random() * 0.5));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleepFn = options.sleepFn ?? sleep;
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !isRetryableError(err)) throw err;
      const delayMs = retryDelayMs(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.(err, attempt + 1, delayMs);
      await sleepFn(delayMs);
    }
  }
  throw lastErr;
}
