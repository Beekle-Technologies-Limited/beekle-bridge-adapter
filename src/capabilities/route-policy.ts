import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareDecimal, isDecimalString } from '../money/decimal-string.js';
import {
  DESTINATION_REQUEST_RAILS,
  DOCS_RETRIEVED_ON,
  EXPLICITLY_UNSUPPORTED_CURRENCIES,
  isCryptoRail,
  isFiatCurrency,
  PEG_CURRENCY,
  REQUEST_CURRENCIES,
  SOURCE_REQUEST_RAILS,
} from './schema-constants.js';

export interface RouteSnapshotPair {
  sourceCurrency: string;
  sourceRail: string;
  destinationCurrency: string;
  destinationRail: string;
  minimum: string;
  explorerKey: string;
  explorerDestination: string;
  mappingNotes: string[];
  sourceRailInCreateRequest: boolean;
  destinationRailInCreateRequest: boolean;
  sourceCurrencyInCreateRequest: boolean;
  destinationCurrencyInCreateRequest: boolean;
}

export interface RouteSnapshot {
  retrievedOn: string;
  sourceUrl: string;
  pairCount: number;
  unmappedCount: number;
  pairs: RouteSnapshotPair[];
  unmapped: unknown[];
}

export interface RouteEvaluation {
  accepted: boolean;
  code: string;
  message: string;
  apiSchemaSupport: 'present' | 'absent' | 'partial';
  routeExplorer: 'listed' | 'not_listed' | 'listed_outside_create_schema';
  accountEligibility: 'unknown';
  commercialAvailability: 'unconfirmed';
  minimum: string | null;
  amountCurrency: string | null;
  mappingNotes: string[];
}

let cached: { snapshot: RouteSnapshot; index: Map<string, RouteSnapshotPair> } | null = null;

export function loadRouteSnapshot(): RouteSnapshot {
  return getCache().snapshot;
}

export function evaluateRoute(input: {
  sourceRail: string;
  sourceCurrency: string;
  destinationRail: string;
  destinationCurrency: string;
  amount?: string;
}): RouteEvaluation {
  const sourceRail = input.sourceRail.trim().toLowerCase();
  const sourceCurrency = input.sourceCurrency.trim().toLowerCase();
  const destinationRail = input.destinationRail.trim().toLowerCase();
  const destinationCurrency = input.destinationCurrency.trim().toLowerCase();
  const base = {
    accountEligibility: 'unknown' as const,
    commercialAvailability: 'unconfirmed' as const,
    minimum: null,
    amountCurrency: null,
    mappingNotes: [] as string[],
  };

  if (
    isExplicitlyUnsupported(sourceCurrency) ||
    isExplicitlyUnsupported(destinationCurrency)
  ) {
    return {
      ...base,
      accepted: false,
      code: 'currency_not_in_bridge_transfer_schema',
      message:
        'These currency codes were not in the EuroInclusiveCurrency enum on the create-transfer page examined on 2026-11-07. This adapter will not send them. That absence is not a survey of every Bridge product.',
      apiSchemaSupport: 'absent',
      routeExplorer: 'not_listed',
    };
  }

  if (sourceRail === 'stellar' || destinationRail === 'stellar') {
    return {
      ...base,
      accepted: false,
      code: 'stellar_route_not_orchestrated',
      message:
        'Stellar appears in the Bridge create-transfer rail enum and in the public route explorer, including Stellar USDC. This adapter does not orchestrate it. Direct Stellar settlement belongs to the separate gateway.',
      apiSchemaSupport: 'present',
      routeExplorer: 'listed',
    };
  }

  const sourceRailKnown = includes(SOURCE_REQUEST_RAILS, sourceRail);
  const destinationRailKnown = includes(DESTINATION_REQUEST_RAILS, destinationRail);
  const sourceCurrencyKnown = includes(REQUEST_CURRENCIES, sourceCurrency);
  const destinationCurrencyKnown = includes(REQUEST_CURRENCIES, destinationCurrency);
  if (
    sourceRailKnown &&
    sourceCurrencyKnown &&
    destinationCurrencyKnown &&
    !destinationRailKnown &&
    includes(SOURCE_REQUEST_RAILS, destinationRail)
  ) {
    return {
      ...base,
      accepted: false,
      code: 'destination_rail_absent_from_create_request_enum',
      message:
        'This destination rail is missing from SepaSwiftInclusiveOfframpPaymentRail on the create-transfer request schema, even if an example or the route explorer mentions it.',
      apiSchemaSupport: 'partial',
      routeExplorer: 'listed',
    };
  }
  if (!sourceRailKnown || !destinationRailKnown || !sourceCurrencyKnown || !destinationCurrencyKnown) {
    return {
      ...base,
      accepted: false,
      code: 'not_in_create_transfer_request_schema',
      message:
        'One or both sides of this route are outside the create-transfer request enums captured on 2026-11-07. Route-explorer-only chains and assets are blocked.',
      apiSchemaSupport: 'absent',
      routeExplorer: 'not_listed',
    };
  }

  if (sourceRail === 'fiat_deposit_return' || destinationRail === 'fiat_deposit_return') {
    return {
      ...base,
      accepted: false,
      code: 'not_a_customer_route',
      message: 'fiat_deposit_return is not a customer-selected orchestration route.',
      apiSchemaSupport: 'present',
      routeExplorer: 'not_listed',
    };
  }

  if (sourceRail === 'swift') {
    return {
      ...base,
      accepted: false,
      code: 'swift_source_not_orchestrated',
      message:
        'A swift source requires features.flexible_amount and no fixed amount. This adapter only orchestrates fixed-amount transfers, and swift has no row in the pinned route explorer.',
      apiSchemaSupport: 'partial',
      routeExplorer: 'not_listed',
    };
  }

  if (sourceRail === 'ach_same_day' || destinationRail === 'ach_same_day') {
    return {
      ...base,
      accepted: false,
      code: 'ach_same_day_not_in_route_explorer',
      message:
        'The fiat page describes same-day ACH as outgoing only. The route explorer has an ACH label, not a distinct ach_same_day row, so this adapter blocks it.',
      apiSchemaSupport: 'present',
      routeExplorer: 'not_listed',
    };
  }

  const pair = getCache().index.get(routeKey(sourceCurrency, sourceRail, destinationCurrency, destinationRail));
  if (!pair) {
    return {
      ...base,
      accepted: false,
      code: 'route_not_in_bridge_explorer',
      message:
        'The create-transfer enums contain these values, but the pinned route explorer has no matching pair. Unknown routes are blocked. Account eligibility is still unknown for listed pairs.',
      apiSchemaSupport: 'present',
      routeExplorer: 'not_listed',
    };
  }

  if (!pair.destinationRailInCreateRequest || !pair.sourceRailInCreateRequest) {
    return {
      ...base,
      accepted: false,
      code: 'destination_rail_absent_from_create_request_enum',
      message: 'The explorer pair is not fully representable on the create-transfer request schema.',
      apiSchemaSupport: 'partial',
      routeExplorer: 'listed',
      mappingNotes: pair.mappingNotes,
    };
  }

  const constraint = documentedConstraintFailure(sourceRail, sourceCurrency, destinationRail, destinationCurrency);
  if (constraint) {
    return {
      ...base,
      accepted: false,
      code: constraint,
      message: 'The route breaks a constraint written on the create-transfer schema.',
      apiSchemaSupport: 'present',
      routeExplorer: 'listed',
      mappingNotes: pair.mappingNotes,
    };
  }

  const amountCurrency = PEG_CURRENCY[sourceCurrency] ?? null;
  if (input.amount !== undefined) {
    if (!isDecimalString(input.amount) || compareDecimal(input.amount, '0') <= 0) {
      return {
        ...base,
        accepted: false,
        code: 'amount_not_decimal',
        message: 'Amount must be a positive decimal string.',
        apiSchemaSupport: 'present',
        routeExplorer: 'listed',
        minimum: pair.minimum,
        amountCurrency,
        mappingNotes: pair.mappingNotes,
      };
    }
    if (compareDecimal(input.amount, pair.minimum) < 0) {
      return {
        ...base,
        accepted: false,
        code: 'below_documented_route_minimum',
        message:
          'Amount is below the minimum published beside this pair in the route explorer. The explorer does not state the unit separately from the route. Bridge remains the authority if it disagrees.',
        apiSchemaSupport: 'present',
        routeExplorer: 'listed',
        minimum: pair.minimum,
        amountCurrency,
        mappingNotes: pair.mappingNotes,
      };
    }
  }

  return {
    accepted: true,
    code: 'api_schema_and_explorer_pair',
    message:
      'The pair is in the pinned route explorer and the create-transfer request enums. Bridge account eligibility and Beekle commercial availability are unconfirmed.',
    apiSchemaSupport: 'present',
    routeExplorer: 'listed',
    accountEligibility: 'unknown',
    commercialAvailability: 'unconfirmed',
    minimum: pair.minimum,
    amountCurrency,
    mappingNotes: pair.mappingNotes,
  };
}

export function capabilitySummary(): {
  docsRetrievedOn: string;
  explorerPairCount: number;
  unmappedExplorerRows: number;
  orchestratedPairCount: number;
  stellarPairsBlocked: number;
  explicitlyUnsupportedCurrencies: readonly string[];
  accountEligibility: 'unknown';
  commercialAvailability: 'unconfirmed';
} {
  const snapshot = loadRouteSnapshot();
  let orchestrated = 0;
  let stellar = 0;
  for (const pair of snapshot.pairs) {
    if (pair.sourceRail === 'stellar' || pair.destinationRail === 'stellar') {
      stellar += 1;
      continue;
    }
    const decision = evaluateRoute({
      sourceRail: pair.sourceRail,
      sourceCurrency: pair.sourceCurrency,
      destinationRail: pair.destinationRail,
      destinationCurrency: pair.destinationCurrency,
      amount: pair.minimum,
    });
    if (decision.accepted) orchestrated += 1;
  }
  return {
    docsRetrievedOn: DOCS_RETRIEVED_ON,
    explorerPairCount: snapshot.pairCount,
    unmappedExplorerRows: snapshot.unmappedCount,
    orchestratedPairCount: orchestrated,
    stellarPairsBlocked: stellar,
    explicitlyUnsupportedCurrencies: EXPLICITLY_UNSUPPORTED_CURRENCIES,
    accountEligibility: 'unknown',
    commercialAvailability: 'unconfirmed',
  };
}

export function capabilityMatrix() {
  const summary = capabilitySummary();
  return {
    examinedOn: DOCS_RETRIEVED_ON,
    examinedSources: [
      'https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer',
      'https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes',
      'https://apidocs.bridge.xyz/platform/orchestration/transfers/transfer-states',
    ],
    listedAssetSupport: {
      createTransferRequestCurrencies: REQUEST_CURRENCIES,
      absentFromExaminedCreateTransferCurrencyEnum: EXPLICITLY_UNSUPPORTED_CURRENCIES,
      meaning:
        'Absence means the code was not in EuroInclusiveCurrency on the create-transfer page examined on 2026-11-07. This adapter will not send it. That is not a finding that every Bridge product page omits it.',
    },
    listedRailSupport: {
      sourceRailsInCreateRequest: SOURCE_REQUEST_RAILS,
      destinationRailsInCreateRequest: DESTINATION_REQUEST_RAILS,
      stellar: {
        inExaminedCreateRequestEnum: true,
        inExaminedRouteExplorer: summary.stellarPairsBlocked > 0,
        orchestratedByThisAdapter: false,
        reason: 'Direct Stellar settlement is outside this adapter. The explorer listing is not an availability claim.',
      },
    },
    orchestratableTransferRoutes: {
      count: summary.orchestratedPairCount,
      explorerPairsMapped: summary.explorerPairCount,
      explorerRowsOutsideCreateSchema: summary.unmappedExplorerRows,
      rule: 'An explorer pair that is also representable on the examined create-transfer request enums, passes the documented currency constraints, and is not a Stellar rail.',
    },
    accountAvailability: {
      status: 'unknown' as const,
      commercialAvailability: 'unconfirmed' as const,
      meaning:
        'A listed asset or an orchestratable route does not mean this Bridge account is endorsed, enabled, or commercially available for it.',
    },
  };
}

function documentedConstraintFailure(
  sourceRail: string,
  sourceCurrency: string,
  destinationRail: string,
  destinationCurrency: string,
): string | null {
  if (sourceCurrency === 'eur' && sourceRail !== 'sepa') return 'eur_source_requires_sepa';
  if (sourceRail === 'sepa' && sourceCurrency !== 'eur') return 'sepa_source_requires_eur';
  if (
    (sourceCurrency === 'eur' || sourceRail === 'sepa') &&
    destinationCurrency !== 'usdc' &&
    destinationCurrency !== 'eurc'
  ) {
    return 'eur_sepa_destination_currency_limited';
  }
  if (destinationCurrency === 'eur' && destinationRail !== 'sepa') return 'eur_destination_requires_sepa';
  if (destinationRail === 'sepa' && destinationCurrency !== 'eur') return 'sepa_destination_requires_eur';
  if (destinationRail === 'swift' && destinationCurrency !== 'usd') return 'swift_destination_requires_usd';
  return null;
}

function isExplicitlyUnsupported(currency: string): boolean {
  return (EXPLICITLY_UNSUPPORTED_CURRENCIES as readonly string[]).includes(currency);
}

function includes(values: readonly string[], value: string): boolean {
  return values.includes(value);
}

function routeKey(sourceCurrency: string, sourceRail: string, destinationCurrency: string, destinationRail: string): string {
  return `${sourceCurrency}|${sourceRail}|${destinationCurrency}|${destinationRail}`;
}

function getCache(): { snapshot: RouteSnapshot; index: Map<string, RouteSnapshotPair> } {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'route-explorer.snapshot.json'),
    join(process.cwd(), 'src/capabilities/route-explorer.snapshot.json'),
    join(process.cwd(), 'dist/capabilities/route-explorer.snapshot.json'),
  ];
  let raw: string | null = null;
  for (const candidate of candidates) {
    try {
      raw = readFileSync(candidate, 'utf8');
      break;
    } catch {
      raw = null;
    }
  }
  if (!raw) throw new Error('route explorer snapshot is missing');
  const snapshot = JSON.parse(raw) as RouteSnapshot;
  const index = new Map<string, RouteSnapshotPair>();
  for (const pair of snapshot.pairs) index.set(routeKey(pair.sourceCurrency, pair.sourceRail, pair.destinationCurrency, pair.destinationRail), pair);
  cached = { snapshot, index };
  return cached;
}

export function endpointFieldErrors(input: {
  sourceRail: string;
  sourceCurrency: string;
  destinationRail: string;
  destinationCurrency: string;
  fromAddress?: string;
  toAddress?: string;
  externalAccountId?: string;
  bridgeWalletId?: string;
  senderReturnUrl?: string;
  reference?: string;
}): string | null {
  const sourceCrypto = isCryptoRail(input.sourceRail);
  const destinationCrypto = isCryptoRail(input.destinationRail);
  const sourceFiat = isFiatCurrency(input.sourceCurrency);
  const destinationFiat = isFiatCurrency(input.destinationCurrency);
  if (input.fromAddress && !sourceCrypto) return 'field_not_applicable';
  if (sourceCrypto && input.sourceRail !== 'bridge_wallet' && !input.fromAddress) return 'from_address_required';
  if (input.sourceRail === 'bridge_wallet' && !input.bridgeWalletId) return 'bridge_wallet_id_required';
  if (input.sourceRail !== 'bridge_wallet' && input.bridgeWalletId && sourceFiat) return 'field_not_applicable';
  if (input.toAddress && !destinationCrypto) return 'field_not_applicable';
  if (destinationCrypto && !input.toAddress) return 'to_address_required';
  if (input.externalAccountId && !destinationFiat) return 'field_not_applicable';
  if (destinationFiat && !input.externalAccountId) return 'external_account_id_required';
  if (input.sourceRail === 'co_bank_transfer' && !input.senderReturnUrl) return 'sender_return_url_required';
  if (input.senderReturnUrl && input.sourceRail !== 'co_bank_transfer') return 'field_not_applicable';
  if (input.reference && !destinationFiat) return 'field_not_applicable';
  return null;
}
