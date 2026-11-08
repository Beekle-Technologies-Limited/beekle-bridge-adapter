import { decideTransition } from './state-machine.js';
import { normalizeProviderState } from './status.js';

describe('transfer state machine', () => {
  const base = {
    currentSequence: null,
    nextSequence: null,
    currentEventCreatedAtMs: null,
    nextEventCreatedAtMs: null,
  };

  it('follows the documented happy path and allows skipped observations', () => {
    expect(decideTransition({ ...base, current: 'awaiting_funds', next: 'funds_received' })).toEqual({
      apply: true,
    });
    expect(decideTransition({ ...base, current: 'funds_received', next: 'payment_submitted' })).toEqual({
      apply: true,
    });
    expect(decideTransition({ ...base, current: 'payment_submitted', next: 'payment_processed' })).toEqual({
      apply: true,
    });
    expect(decideTransition({ ...base, current: 'awaiting_funds', next: 'payment_processed' })).toEqual({
      apply: true,
    });
  });

  it('does not move the happy path backwards', () => {
    expect(decideTransition({ ...base, current: 'payment_processed', next: 'funds_received' })).toEqual({
      apply: false,
      reason: 'regression_blocked',
    });
    expect(decideTransition({ ...base, current: 'payment_submitted', next: 'awaiting_funds' })).toEqual({
      apply: false,
      reason: 'regression_blocked',
    });
  });

  it('cancels only from awaiting_funds and allows the documented exception path', () => {
    expect(decideTransition({ ...base, current: 'awaiting_funds', next: 'canceled' })).toEqual({ apply: true });
    expect(decideTransition({ ...base, current: 'funds_received', next: 'canceled' })).toEqual({
      apply: false,
      reason: 'regression_blocked',
    });
    expect(decideTransition({ ...base, current: 'payment_processed', next: 'returned' })).toEqual({ apply: true });
    expect(decideTransition({ ...base, current: 'returned', next: 'refund_in_flight' })).toEqual({ apply: true });
    expect(decideTransition({ ...base, current: 'refund_in_flight', next: 'refunded' })).toEqual({ apply: true });
    expect(decideTransition({ ...base, current: 'refund_failed', next: 'refund_in_flight' })).toEqual({ apply: true });
    expect(decideTransition({ ...base, current: 'refunded', next: 'refund_in_flight' })).toEqual({
      apply: false,
      reason: 'regression_blocked',
    });
  });

  it('drops stale sequences and older timestamps', () => {
    expect(
      decideTransition({
        ...base,
        current: 'funds_received',
        next: 'payment_processed',
        currentSequence: 5,
        nextSequence: 4,
      }),
    ).toEqual({ apply: false, reason: 'stale_sequence' });
    expect(
      decideTransition({
        ...base,
        current: 'awaiting_funds',
        next: 'funds_received',
        currentEventCreatedAtMs: 2_000,
        nextEventCreatedAtMs: 1_000,
      }),
    ).toEqual({ apply: false, reason: 'stale_event_time' });
  });

  it('does not treat compliance-hold or unknown states as approval', () => {
    expect(normalizeProviderState('kyc_required')).toBe('compliance_hold');
    expect(normalizeProviderState('kyc_in_review')).toBe('compliance_hold');
    expect(normalizeProviderState('developer_kyb_required')).toBe('compliance_hold');
    expect(normalizeProviderState('payment_processed')).toBe('completed');
    expect(normalizeProviderState('something_new')).toBe('unknown_provider_state');
    expect(decideTransition({ ...base, current: 'awaiting_funds', next: 'totally_new' })).toEqual({
      apply: false,
      reason: 'unknown_provider_state',
    });
    expect(decideTransition({ ...base, current: 'payment_processed', next: 'error' })).toEqual({
      apply: false,
      reason: 'regression_blocked',
    });
  });
});
