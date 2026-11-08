import { isKnownProviderState } from './status.js';

export type TransitionReason =
  | 'same_state'
  | 'unknown_provider_state'
  | 'stale_sequence'
  | 'stale_event_time'
  | 'regression_blocked';

export type TransitionDecision = { apply: true } | { apply: false; reason: TransitionReason };

const HAPPY = ['awaiting_funds', 'funds_received', 'payment_submitted', 'payment_processed'] as const;
const COMPLIANCE = new Set<string>(['kyc_required', 'kyc_in_review', 'developer_kyb_required']);

/**
 * Edges the transfer-states guide states outright:
 * - happy path moves awaiting_funds → funds_received → payment_submitted →
 *   payment_processed and never backwards. Missed intermediate observations
 *   may skip forward.
 * - canceled only from awaiting_funds, via DELETE.
 * - returned, refunded, undeliverable, and error are exception paths.
 *
 * Edges marked only by the guide's existence of a state, without a diagram,
 * are adapter policy and are named in the README. Unknown strings do not move
 * the transfer.
 */
export function decideTransition(input: {
  current: string | null;
  next: string;
  currentSequence: number | null;
  nextSequence: number | null;
  currentEventCreatedAtMs: number | null;
  nextEventCreatedAtMs: number | null;
}): TransitionDecision {
  if (!isKnownProviderState(input.next)) {
    return { apply: false, reason: 'unknown_provider_state' };
  }
  if (
    input.nextSequence !== null &&
    input.currentSequence !== null &&
    input.nextSequence <= input.currentSequence
  ) {
    return { apply: false, reason: 'stale_sequence' };
  }
  if (
    input.nextSequence === null &&
    input.currentSequence === null &&
    input.nextEventCreatedAtMs !== null &&
    input.currentEventCreatedAtMs !== null &&
    input.nextEventCreatedAtMs < input.currentEventCreatedAtMs
  ) {
    return { apply: false, reason: 'stale_event_time' };
  }
  if (input.current === null) return { apply: true };
  if (input.current === input.next) return { apply: false, reason: 'same_state' };
  if (!isKnownProviderState(input.current)) return { apply: true };
  if (!canMove(input.current, input.next)) {
    return { apply: false, reason: 'regression_blocked' };
  }
  return { apply: true };
}

function canMove(from: string, to: string): boolean {
  if (from === 'refunded' || from === 'canceled') return false;
  if (to === 'canceled') return from === 'awaiting_funds';

  const fromHappy = (HAPPY as readonly string[]).indexOf(from);
  const toHappy = (HAPPY as readonly string[]).indexOf(to);
  if (fromHappy >= 0 && toHappy > fromHappy) return true;

  if (to === 'in_review') {
    return fromHappy >= 0 || COMPLIANCE.has(from) || from === 'error';
  }
  if (COMPLIANCE.has(to)) {
    return from === 'awaiting_funds' || from === 'in_review' || from === 'error' || COMPLIANCE.has(from);
  }
  if (from === 'in_review' && (toHappy >= 0 || COMPLIANCE.has(to))) return true;
  if (COMPLIANCE.has(from) && (to === 'awaiting_funds' || to === 'in_review' || toHappy >= 0)) return true;

  if (to === 'error') {
    return from !== 'payment_processed' && from !== 'refunded' && from !== 'canceled';
  }
  if (from === 'error' && (toHappy >= 0 || to === 'in_review' || COMPLIANCE.has(to))) return true;

  if (to === 'undeliverable') {
    return ['funds_received', 'payment_submitted', 'payment_processed', 'in_review', 'error'].includes(from);
  }
  if (to === 'returned') {
    return [
      'funds_received',
      'payment_submitted',
      'payment_processed',
      'undeliverable',
      'error',
      'in_review',
    ].includes(from);
  }
  if (to === 'missing_return_policy') {
    return from !== 'refunded' && from !== 'canceled';
  }
  if (to === 'refund_in_flight') {
    return [
      'returned',
      'undeliverable',
      'missing_return_policy',
      'payment_submitted',
      'payment_processed',
      'refund_failed',
      'error',
    ].includes(from);
  }
  if (to === 'refund_failed') return from === 'refund_in_flight' || from === 'returned';
  if (to === 'refunded') {
    return ['refund_in_flight', 'returned', 'refund_failed', 'undeliverable', 'missing_return_policy', 'payment_processed', 'payment_submitted'].includes(
      from,
    );
  }
  return false;
}
