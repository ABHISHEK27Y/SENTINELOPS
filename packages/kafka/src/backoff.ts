/**
 * Retry backoff. Pure functions so they are trivially unit-testable and shared
 * by producers and consumers.
 *
 * Exponential backoff with full jitter (AWS "Exponential Backoff and Jitter"):
 *   delay = random(0, min(cap, base * 2^attempt))
 * Full jitter avoids thundering-herd retries across many consumers.
 */
export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  maxRetries?: number;
}

export const DEFAULT_BACKOFF: Required<BackoffOptions> = {
  baseMs: 200,
  capMs: 10_000,
  maxRetries: 5,
};

/** The upper bound of the delay window for a given attempt (0-indexed). */
export function backoffCeiling(attempt: number, opts: BackoffOptions = {}): number {
  const { baseMs, capMs } = { ...DEFAULT_BACKOFF, ...opts };
  const exp = baseMs * 2 ** Math.max(0, attempt);
  return Math.min(capMs, exp);
}

/** The actual (jittered) delay to wait before the next attempt. */
export function backoffDelay(
  attempt: number,
  opts: BackoffOptions = {},
  rng: () => number = Math.random
): number {
  return Math.floor(rng() * backoffCeiling(attempt, opts));
}

export function shouldRetry(attempt: number, opts: BackoffOptions = {}): boolean {
  const { maxRetries } = { ...DEFAULT_BACKOFF, ...opts };
  return attempt < maxRetries;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
