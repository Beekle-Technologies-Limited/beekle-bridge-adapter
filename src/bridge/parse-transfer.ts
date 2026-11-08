import { isDecimalString } from '../money/decimal-string.js';
import { ProviderCallError, ProviderRouteCheck, ProviderTransfer } from './types.js';

const INSTRUCTION_KEYS = new Set([
  'payment_rail',
  'amount',
  'currency',
  'deposit_message',
  'bank_name',
  'bank_address',
  'bank_routing_number',
  'bank_account_number',
  'bank_beneficiary_name',
  'bank_beneficiary_address',
  'from_address',
  'to_address',
  'iban',
  'bic',
  'clabe',
  'br_code',
  'account_number',
]);

const RECEIPT_KEYS = new Set([
  'initial_amount',
  'initial_amount_currency',
  'developer_fee',
  'developer_fee_currency',
  'exchange_fee',
  'exchange_fee_currency',
  'subtotal_amount',
  'subtotal_amount_currency',
  'gas_fee',
  'gas_fee_currency',
  'final_amount',
  'final_amount_currency',
  'source_tx_hash',
  'destination_tx_hash',
  'url',
]);

const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

export function parseProviderTransfer(value: unknown): ProviderTransfer {
  if (!isRecord(value)) throw new ProviderCallError(502, 'provider_response_invalid');
  const id = stringField(value.id);
  const state = stringField(value.state);
  const amount = stringField(value.amount);
  const onBehalfOf = stringField(value.on_behalf_of);
  const source = isRecord(value.source) ? value.source : null;
  const destination = isRecord(value.destination) ? value.destination : null;
  if (!id || !state || !amount || !onBehalfOf || !source || !destination) {
    throw new ProviderCallError(502, 'provider_response_invalid');
  }
  if (!isDecimalString(amount)) throw new ProviderCallError(502, 'provider_amount_not_decimal');
  const sourceRail = stringField(source.payment_rail);
  const sourceCurrency = stringField(source.currency);
  const destinationRail = stringField(destination.payment_rail);
  const destinationCurrency = stringField(destination.currency);
  if (!sourceRail || !sourceCurrency || !destinationRail || !destinationCurrency) {
    throw new ProviderCallError(502, 'provider_response_invalid');
  }
  const developerFee = stringField(value.developer_fee);
  if (developerFee !== null && !isDecimalString(developerFee)) {
    throw new ProviderCallError(502, 'provider_amount_not_decimal');
  }
  return {
    id,
    state,
    amount,
    currency: stringField(value.currency),
    developerFee,
    onBehalfOf,
    clientReferenceId: stringField(value.client_reference_id),
    source: {
      paymentRail: sourceRail,
      currency: sourceCurrency,
      fromAddress: stringField(source.from_address),
    },
    destination: {
      paymentRail: destinationRail,
      currency: destinationCurrency,
      toAddress: stringField(destination.to_address),
      externalAccountId: stringField(destination.external_account_id),
    },
    depositInstructions: allowlistedStrings(value.source_deposit_instructions, INSTRUCTION_KEYS),
    receipt: allowlistedStrings(value.receipt, RECEIPT_KEYS),
    createdAt: stringField(value.created_at),
    updatedAt: stringField(value.updated_at),
  };
}

export function parseRouteCheck(value: unknown): ProviderRouteCheck {
  if (!isRecord(value) || (value.state !== 'valid' && value.state !== 'invalid') || !Array.isArray(value.notes)) {
    throw new ProviderCallError(502, 'provider_response_invalid');
  }
  const notes = value.notes
    .filter((note): note is string => typeof note === 'string' && /^[\x20-\x7E]{1,200}$/.test(note) && !/@/.test(note))
    .slice(0, 10);
  return { state: value.state, notes };
}

export function parseTransferList(value: unknown): ProviderTransfer[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new ProviderCallError(502, 'provider_response_invalid');
  return value.data.map((item) => parseProviderTransfer(item));
}

export function safeProviderErrorCode(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.code === 'string' && SAFE_CODE.test(value.code)) return value.code;
  if (Array.isArray(value.errors) && isRecord(value.errors[0]) && typeof value.errors[0].code === 'string') {
    return SAFE_CODE.test(value.errors[0].code) ? value.errors[0].code : null;
  }
  return null;
}

function allowlistedStrings(value: unknown, keys: Set<string>): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!keys.has(key) || typeof raw !== 'string' || raw.length > 512) continue;
    if ((key === 'amount' || key.endsWith('_amount') || key === 'developer_fee' || key === 'exchange_fee' || key === 'gas_fee') && !isDecimalString(raw)) {
      continue;
    }
    if (key === 'url' && !raw.startsWith('https://')) continue;
    out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function stringField(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 512) return null;
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
