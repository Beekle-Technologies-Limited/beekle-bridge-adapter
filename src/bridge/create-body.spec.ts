import { toBridgeCreateBody } from './create-body.js';

describe('Bridge create body', () => {
  it('maps a fixed-amount ACH push onramp onto the documented request fields', () => {
    expect(
      toBridgeCreateBody({
        outboundIdempotencyKey: 'ignored-here',
        amount: '75.0',
        onBehalfOf: 'cust_alice',
        developerFee: null,
        clientReferenceId: 'client_transfer_id_123',
        source: { paymentRail: 'ach_push', currency: 'usd' },
        destination: {
          paymentRail: 'ethereum',
          currency: 'usdc',
          toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        },
      }),
    ).toEqual({
      amount: '75.0',
      on_behalf_of: 'cust_alice',
      client_reference_id: 'client_transfer_id_123',
      source: { payment_rail: 'ach_push', currency: 'usd' },
      destination: {
        payment_rail: 'ethereum',
        currency: 'usdc',
        to_address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
    });
  });

  it('refuses to build a Stellar destination body', () => {
    expect(() =>
      toBridgeCreateBody({
        outboundIdempotencyKey: 'k',
        amount: '10.00',
        onBehalfOf: 'cust_alice',
        developerFee: null,
        clientReferenceId: null,
        source: { paymentRail: 'ach_push', currency: 'usd' },
        destination: { paymentRail: 'stellar', currency: 'usdc', toAddress: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567' },
      }),
    ).toThrow('stellar_route_not_orchestrated');
  });

  it('sends a SEPA reference under the documented field name', () => {
    const body = toBridgeCreateBody({
      outboundIdempotencyKey: 'k',
      amount: '25.00',
      onBehalfOf: 'cust_alice',
      developerFee: '0.10',
      clientReferenceId: null,
      source: { paymentRail: 'ethereum', currency: 'usdc', fromAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' },
      destination: {
        paymentRail: 'sepa',
        currency: 'eur',
        externalAccountId: 'ext_account_1',
        reference: 'Invoice 1001',
      },
    });
    expect(body.developer_fee).toBe('0.10');
    expect((body.destination as { sepa_reference: string }).sepa_reference).toBe('Invoice 1001');
  });
});
