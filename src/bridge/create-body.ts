import { CreateProviderTransfer } from './types.js';

const SEPA_REFERENCE = /^[A-Za-z0-9 &\-./]{6,140}$/;
const ACH_REFERENCE = /^[A-Za-z0-9 ]{1,10}$/;
const SPEI_REFERENCE = /^[A-Za-z0-9 ]{1,40}$/;
const SWIFT_CHARSET = /^[A-Za-z0-9 /\-?:().,'+]+$/;
const ADDRESS = /^[A-Za-z0-9:_-]{1,256}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function referenceError(rail: string, reference: string): string | null {
  if (rail === 'sepa') return SEPA_REFERENCE.test(reference) ? null : 'invalid_sepa_reference';
  if (rail === 'ach' || rail === 'ach_push') return ACH_REFERENCE.test(reference) ? null : 'invalid_ach_reference';
  if (rail === 'spei') return SPEI_REFERENCE.test(reference) ? null : 'invalid_spei_reference';
  if (rail === 'wire') return wireError(reference, 'invalid_wire_message');
  if (rail === 'swift') return wireError(reference, 'invalid_swift_reference');
  return 'reference_not_supported_for_rail';
}

export function endpointTokenError(input: CreateProviderTransfer): string | null {
  if (input.source.fromAddress && !ADDRESS.test(input.source.fromAddress)) return 'invalid_from_address';
  if (input.destination.toAddress && !ADDRESS.test(input.destination.toAddress)) return 'invalid_to_address';
  if (input.destination.externalAccountId && !OPAQUE_ID.test(input.destination.externalAccountId)) {
    return 'invalid_external_account_id';
  }
  if (input.source.bridgeWalletId && !OPAQUE_ID.test(input.source.bridgeWalletId)) return 'invalid_bridge_wallet_id';
  if (input.onBehalfOf && !OPAQUE_ID.test(input.onBehalfOf)) return 'invalid_customer_reference';
  if (input.destination.reference) {
    const reference = referenceError(input.destination.paymentRail, input.destination.reference);
    if (reference) return reference;
  }
  if (input.source.senderReturnUrl && !isPublicHttpsUrl(input.source.senderReturnUrl)) return 'invalid_sender_return_url';
  return null;
}

export function toBridgeCreateBody(input: CreateProviderTransfer): Record<string, unknown> {
  const tokenError = endpointTokenError(input);
  if (tokenError) throw new Error(tokenError);
  if (input.source.paymentRail === 'stellar' || input.destination.paymentRail === 'stellar') {
    throw new Error('stellar_route_not_orchestrated');
  }
  const source: Record<string, unknown> = {
    payment_rail: input.source.paymentRail,
    currency: input.source.currency,
  };
  if (input.source.fromAddress) source.from_address = input.source.fromAddress;
  if (input.source.bridgeWalletId) source.bridge_wallet_id = input.source.bridgeWalletId;
  if (input.source.senderReturnUrl) {
    source.co_bank_transfer = { redirect_url: input.source.senderReturnUrl };
  }
  const destination: Record<string, unknown> = {
    payment_rail: input.destination.paymentRail,
    currency: input.destination.currency,
  };
  if (input.destination.toAddress) destination.to_address = input.destination.toAddress;
  if (input.destination.externalAccountId) destination.external_account_id = input.destination.externalAccountId;
  if (input.destination.reference) assignReference(destination, input.destination.paymentRail, input.destination.reference);

  const body: Record<string, unknown> = {
    amount: input.amount,
    on_behalf_of: input.onBehalfOf,
    source,
    destination,
  };
  if (input.developerFee !== null) body.developer_fee = input.developerFee;
  if (input.clientReferenceId) body.client_reference_id = input.clientReferenceId;
  if (input.dryRun) body.dry_run = true;
  return body;
}

function assignReference(destination: Record<string, unknown>, rail: string, reference: string): void {
  if (rail === 'sepa') destination.sepa_reference = reference;
  else if (rail === 'ach' || rail === 'ach_push') destination.ach_reference = reference;
  else if (rail === 'wire') destination.wire_message = reference;
  else if (rail === 'spei') destination.spei_reference = reference;
  else if (rail === 'swift') destination.swift_reference = reference;
  else throw new Error('reference_not_supported_for_rail');
}

function wireError(reference: string, code: string): string | null {
  if (reference.length < 1 || reference.length > 140) return code;
  const lines = reference.split('\n');
  if (lines.length > 4) return code;
  if (lines.some((line) => line.length > 35 || !SWIFT_CHARSET.test(line))) return code;
  return null;
}

function isPublicHttpsUrl(value: string): boolean {
  if (value.length > 512) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === '0.0.0.0') return false;
  return true;
}
