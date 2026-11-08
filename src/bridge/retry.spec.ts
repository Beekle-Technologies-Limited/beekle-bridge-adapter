import { retryDelayMs, shouldRetryProviderCall } from './retry.js';

describe('retry policy', () => {
  it('retries the documented transient statuses and the idempotent 409 conflict', () => {
    expect(shouldRetryProviderCall({ method: 'POST', status: 409, errorCode: 'resource_state_conflict', networkFailure: false })).toBe(true);
    expect(shouldRetryProviderCall({ method: 'POST', status: 409, errorCode: 'invalid_state', networkFailure: false })).toBe(false);
    expect(shouldRetryProviderCall({ method: 'GET', status: 409, errorCode: 'resource_state_conflict', networkFailure: false })).toBe(false);
    for (const status of [408, 424, 429, 500, 502, 503, 504]) {
      expect(shouldRetryProviderCall({ method: 'GET', status, errorCode: null, networkFailure: false })).toBe(true);
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(shouldRetryProviderCall({ method: 'POST', status, errorCode: 'duplicate_record', networkFailure: false })).toBe(false);
    }
  });

  it('bounds backoff', () => {
    expect(retryDelayMs(1, () => 0)).toBe(200);
    expect(retryDelayMs(8, () => 0.99)).toBeLessThanOrEqual(2000);
  });
});
