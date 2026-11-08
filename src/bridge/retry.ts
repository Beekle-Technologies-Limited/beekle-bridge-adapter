export interface RetryDecisionInput {
  method: 'GET' | 'POST' | 'DELETE';
  status: number | null;
  errorCode: string | null;
  networkFailure: boolean;
}

/**
 * Retry only when Bridge documents the failure as retryable and the request
 * keeps the same Idempotency-Key for POST.
 *
 * - 409 retries only for `resource_state_conflict` (create-transfer page).
 *   Other 409s are not retried (error-recovery page: wait for a valid state).
 * - 424, 500, and 503 are retried per the error-recovery page. 408, 429, 502,
 *   and 504 are treated as the same transient class.
 * - 400, 401, 403, 404, and 422 are not retried.
 */
export function shouldRetryProviderCall(input: RetryDecisionInput): boolean {
  if (input.networkFailure) return true;
  if (input.status === null) return false;
  if (input.status === 409) return input.errorCode === 'resource_state_conflict' && input.method === 'POST';
  return [408, 424, 429, 500, 502, 503, 504].includes(input.status);
}

export function retryDelayMs(attempt: number, random: () => number): number {
  const cappedAttempt = Math.min(Math.max(attempt, 1), 4);
  const base = 200 * 2 ** (cappedAttempt - 1);
  const jitter = Math.floor(random() * 100);
  return Math.min(base + jitter, 2_000);
}
