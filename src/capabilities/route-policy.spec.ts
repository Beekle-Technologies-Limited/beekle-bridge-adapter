import { capabilityMatrix, capabilitySummary, evaluateRoute } from './route-policy.js';

describe('route policy', () => {
  it('accepts a documented USD ACH push to Ethereum USDC without claiming eligibility', () => {
    const decision = evaluateRoute({
      sourceRail: 'ach_push',
      sourceCurrency: 'usd',
      destinationRail: 'ethereum',
      destinationCurrency: 'usdc',
      amount: '75.0',
    });
    expect(decision.accepted).toBe(true);
    expect(decision.code).toBe('api_schema_and_explorer_pair');
    expect(decision.accountEligibility).toBe('unknown');
    expect(decision.commercialAvailability).toBe('unconfirmed');
    expect(decision.minimum).toBe('1');
    expect(decision.amountCurrency).toBe('usd');
  });

  it('blocks Stellar USDC even though the explorer and API enum list it', () => {
    const decision = evaluateRoute({
      sourceRail: 'ach_push',
      sourceCurrency: 'usd',
      destinationRail: 'stellar',
      destinationCurrency: 'usdc',
      amount: '10.00',
    });
    expect(decision.accepted).toBe(false);
    expect(decision.code).toBe('stellar_route_not_orchestrated');
    expect(decision.routeExplorer).toBe('listed');
  });

  it('blocks GHS, NGN, and RMB rather than inventing corridors', () => {
    for (const currency of ['ghs', 'ngn', 'cny', 'rmb']) {
      const decision = evaluateRoute({
        sourceRail: 'ach_push',
        sourceCurrency: currency,
        destinationRail: 'ethereum',
        destinationCurrency: 'usdc',
        amount: '10.00',
      });
      expect(decision.accepted).toBe(false);
      expect(decision.code).toBe('currency_not_in_bridge_transfer_schema');
    }
  });

  it('blocks explorer-only chains and destination rails missing from the create request enum', () => {
    expect(
      evaluateRoute({
        sourceRail: 'ach_push',
        sourceCurrency: 'usd',
        destinationRail: 'hyperevm',
        destinationCurrency: 'usdc',
        amount: '10',
      }).code,
    ).toBe('not_in_create_transfer_request_schema');
    expect(
      evaluateRoute({
        sourceRail: 'ethereum',
        sourceCurrency: 'usdc',
        destinationRail: 'pix',
        destinationCurrency: 'brl',
        amount: '20',
      }).code,
    ).toBe('destination_rail_absent_from_create_request_enum');
    expect(
      evaluateRoute({
        sourceRail: 'ethereum',
        sourceCurrency: 'usdc',
        destinationRail: 'faster_payments',
        destinationCurrency: 'gbp',
        amount: '20',
      }).code,
    ).toBe('destination_rail_absent_from_create_request_enum');
  });

  it('blocks unknown rails and amounts under the published minimum', () => {
    expect(
      evaluateRoute({
        sourceRail: 'carrier_pigeon',
        sourceCurrency: 'usd',
        destinationRail: 'ethereum',
        destinationCurrency: 'usdc',
      }).accepted,
    ).toBe(false);
    expect(
      evaluateRoute({
        sourceRail: 'ach_push',
        sourceCurrency: 'usd',
        destinationRail: 'ethereum',
        destinationCurrency: 'usdc',
        amount: '0.50',
      }).code,
    ).toBe('below_documented_route_minimum');
  });

  it('summarizes orchestrated pairs as a subset of the explorer', () => {
    const summary = capabilitySummary();
    expect(summary.docsRetrievedOn).toBe('2026-11-07');
    expect(summary.explorerPairCount).toBeGreaterThan(summary.orchestratedPairCount);
    expect(summary.stellarPairsBlocked).toBeGreaterThan(0);
    expect(summary.orchestratedPairCount).toBeGreaterThan(0);
    expect(summary.accountEligibility).toBe('unknown');
  });

  it('separates listed assets, orchestratable routes, and account availability', () => {
    const matrix = capabilityMatrix();
    expect(matrix.listedAssetSupport.createTransferRequestCurrencies).toContain('usdc');
    expect(matrix.listedAssetSupport.absentFromExaminedCreateTransferCurrencyEnum).toEqual([
      'ghs',
      'ngn',
      'cny',
      'rmb',
      'cnh',
    ]);
    expect(matrix.listedAssetSupport.meaning).toContain('not a finding');
    expect(matrix.listedRailSupport.stellar.inExaminedCreateRequestEnum).toBe(true);
    expect(matrix.listedRailSupport.stellar.orchestratedByThisAdapter).toBe(false);
    expect(matrix.orchestratableTransferRoutes.count).toBeGreaterThan(0);
    expect(matrix.accountAvailability.status).toBe('unknown');
  });
});
