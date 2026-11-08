export const DOCS_RETRIEVED_ON = '2026-11-07';

export const SOURCE_REQUEST_RAILS = [
  'ach',
  'wire',
  'ach_push',
  'ach_same_day',
  'fednow',
  'arbitrum',
  'avalanche_c_chain',
  'base',
  'bre_b',
  'co_bank_transfer',
  'bridge_wallet',
  'celo',
  'ethereum',
  'faster_payments',
  'linea',
  'optimism',
  'pix',
  'polygon',
  'sepa',
  'solana',
  'spei',
  'stellar',
  'swift',
  'tempo',
  'tron',
  'xdc',
] as const;

export const DESTINATION_REQUEST_RAILS = [
  'ach',
  'wire',
  'ach_push',
  'ach_same_day',
  'fednow',
  'arbitrum',
  'avalanche_c_chain',
  'base',
  'bre_b',
  'co_bank_transfer',
  'celo',
  'ethereum',
  'fiat_deposit_return',
  'linea',
  'optimism',
  'polygon',
  'sepa',
  'solana',
  'spei',
  'stellar',
  'swift',
  'tempo',
  'tron',
  'xdc',
] as const;

export const REQUEST_CURRENCIES = [
  'brl',
  'cop',
  'eur',
  'eurc',
  'gbp',
  'mxn',
  'ousd',
  'path_usd',
  'pyusd',
  'usd',
  'usdb',
  'usdc',
  'usdt',
  'usdl_linea',
] as const;

export const FIAT_CURRENCIES = ['usd', 'eur', 'mxn', 'brl', 'cop', 'gbp'] as const;

export const EXPLICITLY_UNSUPPORTED_CURRENCIES = ['ghs', 'ngn', 'cny', 'rmb', 'cnh'] as const;

export const PEG_CURRENCY: Record<string, string> = {
  usd: 'usd',
  eur: 'eur',
  mxn: 'mxn',
  brl: 'brl',
  cop: 'cop',
  gbp: 'gbp',
  usdc: 'usd',
  usdt: 'usd',
  usdb: 'usd',
  pyusd: 'usd',
  ousd: 'usd',
  path_usd: 'usd',
  usdl_linea: 'usd',
  eurc: 'eur',
};

export type SourceRail = (typeof SOURCE_REQUEST_RAILS)[number];
export type DestinationRail = (typeof DESTINATION_REQUEST_RAILS)[number];
export type RequestCurrency = (typeof REQUEST_CURRENCIES)[number];

const CRYPTO_RAILS = new Set([
  'arbitrum',
  'avalanche_c_chain',
  'base',
  'celo',
  'ethereum',
  'linea',
  'optimism',
  'polygon',
  'solana',
  'tempo',
  'tron',
  'xdc',
  'stellar',
]);

export function isCryptoRail(rail: string): boolean {
  return CRYPTO_RAILS.has(rail);
}

export function isFiatCurrency(currency: string): boolean {
  return (FIAT_CURRENCIES as readonly string[]).includes(currency);
}
