/**
 * Parse the route matrix embedded in Bridge's public "Supported blockchains
 * and fiat rails" page into a pinned JSON snapshot.
 *
 * Input is a saved copy of:
 * https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes
 *
 * The snapshot records what that page listed on the retrieval date. It is not
 * a Beekle commercial agreement and it is not account eligibility.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath || !outputPath) {
  console.error('usage: parse-route-explorer.mjs <source.txt> <output.json>');
  process.exit(1);
}

const SOURCE_REQUEST_RAILS = new Set([
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
]);

const DESTINATION_REQUEST_RAILS = new Set([
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
]);

const REQUEST_CURRENCIES = new Set([
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
]);

const CURRENCY = {
  USD: 'usd',
  EUR: 'eur',
  MXN: 'mxn',
  BRL: 'brl',
  GBP: 'gbp',
  COP: 'cop',
  USDC: 'usdc',
  EURC: 'eurc',
  USDT: 'usdt',
  USDB: 'usdb',
  OUSD: 'ousd',
  PYUSD: 'pyusd',
  PATHUSD: 'path_usd',
};

const RAIL = {
  Arbitrum: ['arbitrum'],
  'Avalanche C-Chain': ['avalanche_c_chain'],
  Base: ['base'],
  Celo: ['celo'],
  XDC: ['xdc'],
  Ethereum: ['ethereum'],
  Linea: ['linea'],
  Optimism: ['optimism'],
  Polygon: ['polygon'],
  Solana: ['solana'],
  Tempo: ['tempo'],
  Tron: ['tron'],
  Stellar: ['stellar'],
  'Bridge Wallet': ['bridge_wallet'],
  ACH: ['ach', 'ach_push'],
  FedNow: ['fednow'],
  Wire: ['wire'],
  SEPA: ['sepa'],
  SPEI: ['spei'],
  Pix: ['pix'],
  'Faster Payments': ['faster_payments'],
  'Bre-B & Bank Transfer': ['bre_b', 'co_bank_transfer'],
};

const text = readFileSync(inputPath, 'utf8');
const start = text.indexOf('const ROUTES = {');
if (start < 0) {
  throw new Error('ROUTES object not found in source');
}
const body = text.slice(start);
const keyRe = /"([^"]+)":\s*\[/g;
const pairs = new Map();
const unmapped = [];
let match;
const matches = [];
while ((match = keyRe.exec(body)) !== null) {
  matches.push({ key: match[1], index: match.index, open: keyRe.lastIndex });
}
if (matches.length < 10) {
  throw new Error(`expected many route keys, found ${matches.length}`);
}

function compareDecimalStrings(a, b) {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const an = ai.replace(/^0+/, '') || '0';
  const bn = bi.replace(/^0+/, '') || '0';
  if (an.length !== bn.length) return an.length > bn.length ? 1 : -1;
  if (an !== bn) return an > bn ? 1 : -1;
  const scale = Math.max(af.length, bf.length);
  const ap = af.padEnd(scale, '0');
  const bp = bf.padEnd(scale, '0');
  if (ap === bp) return 0;
  return ap > bp ? 1 : -1;
}

for (let i = 0; i < matches.length; i += 1) {
  const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
  const block = body.slice(matches[i].open, end);
  const close = block.indexOf('\n]');
  const arrayText = close >= 0 ? block.slice(0, close) : block;
  const source = splitLabel(matches[i].key);
  const destRe = /\{[^{}]*chain:\s*"([^"]+)"[^{}]*currency:\s*"([^"]+)"[^{}]*min:\s*(\d+)[^{}]*\}/g;
  let dest;
  let destCount = 0;
  while ((dest = destRe.exec(arrayText)) !== null) {
    destCount += 1;
    const destination = { label: dest[1], currencyLabel: dest[2], minimum: dest[3] };
    expand(source, destination);
  }
  if (destCount === 0) {
    unmapped.push({
      explorerKey: matches[i].key.trim(),
      reason: 'no_destination_rows_parsed',
    });
  }
}

function splitLabel(raw) {
  const trimmed = raw.trim();
  const at = trimmed.indexOf('@');
  if (at < 0) return { currencyLabel: trimmed, railLabel: '', raw: trimmed };
  return {
    currencyLabel: trimmed.slice(0, at).trim(),
    railLabel: trimmed.slice(at + 1).trim(),
    raw: trimmed,
  };
}

function expand(source, destination) {
  const sourceCurrencies = CURRENCY[source.currencyLabel];
  const sourceRails = RAIL[source.railLabel];
  const destCurrencies = CURRENCY[destination.currencyLabel];
  const destRails = RAIL[destination.label];
  if (!sourceCurrencies || !sourceRails || !destCurrencies || !destRails) {
    unmapped.push({
      explorerKey: source.raw,
      sourceCurrencyLabel: source.currencyLabel,
      sourceRailLabel: source.railLabel,
      destinationRailLabel: destination.label,
      destinationCurrencyLabel: destination.currencyLabel,
      minimum: destination.minimum,
      reason: 'label_not_in_create_transfer_schema_map',
    });
    return;
  }
  for (const sourceRail of sourceRails) {
    for (const destinationRail of destRails) {
      const mappingNotes = [];
      if (source.railLabel === 'ACH') {
        mappingNotes.push('explorer_ACH_label_mapped_to_ach_and_ach_push');
      }
      if (destination.label === 'ACH') {
        mappingNotes.push('explorer_ACH_label_mapped_to_ach_and_ach_push');
      }
      if (source.railLabel === 'Bre-B & Bank Transfer' || destination.label === 'Bre-B & Bank Transfer') {
        mappingNotes.push('explorer_groups_bre_b_and_co_bank_transfer');
      }
      const key = [sourceCurrencies, sourceRail, destCurrencies, destinationRail].join('|');
      const row = {
        sourceCurrency: sourceCurrencies,
        sourceRail,
        destinationCurrency: destCurrencies,
        destinationRail,
        minimum: destination.minimum,
        explorerKey: source.raw,
        explorerDestination: `${destination.label}/${destination.currencyLabel}`,
        mappingNotes,
        sourceRailInCreateRequest: SOURCE_REQUEST_RAILS.has(sourceRail),
        destinationRailInCreateRequest: DESTINATION_REQUEST_RAILS.has(destinationRail),
        sourceCurrencyInCreateRequest: REQUEST_CURRENCIES.has(sourceCurrencies),
        destinationCurrencyInCreateRequest: REQUEST_CURRENCIES.has(destCurrencies),
      };
      const existing = pairs.get(key);
      if (!existing) {
        pairs.set(key, row);
        continue;
      }
      if (compareDecimalStrings(row.minimum, existing.minimum) > 0) {
        existing.minimum = row.minimum;
      }
      for (const note of mappingNotes) {
        if (!existing.mappingNotes.includes(note)) existing.mappingNotes.push(note);
      }
    }
  }
}

const snapshot = {
  retrievedOn: '2026-11-07',
  sourceUrl: 'https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes',
  createTransferDocUrl: 'https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer',
  note: 'Parsed from the public route explorer embedded in the source page. API schema flags use the create-transfer request enums captured the same day. This is not account eligibility and not a Beekle commercial corridor.',
  pairCount: pairs.size,
  unmappedCount: unmapped.length,
  pairs: [...pairs.values()].sort((a, b) =>
    `${a.sourceCurrency}|${a.sourceRail}|${a.destinationCurrency}|${a.destinationRail}`.localeCompare(
      `${b.sourceCurrency}|${b.sourceRail}|${b.destinationCurrency}|${b.destinationRail}`,
    ),
  ),
  unmapped,
};

writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      pairs: snapshot.pairCount,
      unmapped: snapshot.unmappedCount,
      stellar: snapshot.pairs.filter((p) => p.sourceRail === 'stellar' || p.destinationRail === 'stellar').length,
      pixDestination: snapshot.pairs.filter((p) => p.destinationRail === 'pix').length,
      ethereumUsdcFromAchPush: snapshot.pairs.filter(
        (p) =>
          p.sourceCurrency === 'usd' &&
          p.sourceRail === 'ach_push' &&
          p.destinationCurrency === 'usdc' &&
          p.destinationRail === 'ethereum',
      ),
    },
    null,
    2,
  ),
);
