/**
 * Bridge transfer states, grounded in the docs retrieved 2026-11-07.
 *
 * Sources:
 * - https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-states
 * - create-transfer OpenAPI `TransferState` (omits `error` and `missing_return_policy`)
 * - get-all-transfers query enum (adds `kyc_required`, `kyc_in_review`, `developer_kyb_required`)
 *
 * `completed` is this adapter's name for Bridge `payment_processed`. It means
 * the provider reported that state. It is not a Beekle commercial confirmation
 * and, under the fake provider, it is not a Bridge or bank or chain settlement.
 */
export const KNOWN_PROVIDER_STATES = [
  'awaiting_funds',
  'in_review',
  'funds_received',
  'payment_submitted',
  'payment_processed',
  'canceled',
  'undeliverable',
  'returned',
  'missing_return_policy',
  'refunded',
  'refund_in_flight',
  'refund_failed',
  'error',
  'kyc_required',
  'kyc_in_review',
  'developer_kyb_required',
] as const;

export type KnownProviderState = (typeof KNOWN_PROVIDER_STATES)[number];

export type NormalizedStatus =
  | 'submitting'
  | 'submit_failed'
  | 'awaiting_funds'
  | 'in_review'
  | 'funds_received'
  | 'payment_submitted'
  | 'completed'
  | 'undeliverable'
  | 'returned'
  | 'missing_return_policy'
  | 'refunded'
  | 'refund_in_flight'
  | 'refund_failed'
  | 'canceled'
  | 'error'
  | 'compliance_hold'
  | 'unknown_provider_state';

const MAP: Record<KnownProviderState, NormalizedStatus> = {
  awaiting_funds: 'awaiting_funds',
  in_review: 'in_review',
  funds_received: 'funds_received',
  payment_submitted: 'payment_submitted',
  payment_processed: 'completed',
  canceled: 'canceled',
  undeliverable: 'undeliverable',
  returned: 'returned',
  missing_return_policy: 'missing_return_policy',
  refunded: 'refunded',
  refund_in_flight: 'refund_in_flight',
  refund_failed: 'refund_failed',
  error: 'error',
  kyc_required: 'compliance_hold',
  kyc_in_review: 'compliance_hold',
  developer_kyb_required: 'compliance_hold',
};

export function isKnownProviderState(value: string): value is KnownProviderState {
  return Object.prototype.hasOwnProperty.call(MAP, value);
}

export function normalizeProviderState(value: string): NormalizedStatus {
  if (!isKnownProviderState(value)) return 'unknown_provider_state';
  return MAP[value];
}

export function isTerminalNormalized(status: NormalizedStatus): boolean {
  return status === 'refunded' || status === 'canceled' || status === 'submit_failed';
}
