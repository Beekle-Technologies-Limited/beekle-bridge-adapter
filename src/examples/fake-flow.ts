/**
 * Local demonstration of the fake provider. It boots the adapter, creates one
 * fixed-amount USD ACH-push to Ethereum USDC transfer, advances only the fake
 * provider record, and reconciles that record into the local transfer.
 *
 * Nothing in this script calls Bridge, a bank, or a blockchain.
 */
import request from 'supertest';
import { createApp } from '../main.js';

process.env.NODE_ENV ??= 'development';
process.env.BRIDGE_PROVIDER ??= 'fake';
process.env.BRIDGE_ENVIRONMENT ??= 'sandbox';
process.env.BRIDGE_ALLOW_PRODUCTION ??= 'false';
process.env.BRIDGE_BASE_URL ??= 'https://api.sandbox.bridge.xyz/v0';
process.env.DATABASE_NAME ??= 'beekle_bridge';
process.env.RECONCILE_INTERVAL_MS ??= '0';

for (const name of ['OPERATOR_API_KEY', 'MERCHANT_API_KEYS', 'DATABASE_PASSWORD', 'LOCAL_DEMO_APPROVAL_REFS']) {
  if (!process.env[name]) {
    console.error(`Set ${name} before running the example. This script has no built-in credential.`);
    process.exit(1);
  }
}

const merchantKey = process.env.EXAMPLE_MERCHANT_KEY ?? process.env.MERCHANT_API_KEYS?.split(':').slice(1).join(':');
const operatorKey = process.env.EXAMPLE_OPERATOR_KEY ?? process.env.OPERATOR_API_KEY;
if (!merchantKey || !operatorKey) {
  console.error('Set OPERATOR_API_KEY and MERCHANT_API_KEYS before running the example.');
  process.exit(1);
}
const merchant = `Bearer ${merchantKey}`;
const operator = `Bearer ${operatorKey}`;

const body = {
  complianceDecisionRef: 'dec_local_demo',
  onBehalfOf: 'cust_local_demo',
  clientReferenceId: `local-demo-${Date.now()}`,
  amount: '250.00',
  source: { paymentRail: 'ach_push', currency: 'usd' },
  destination: {
    paymentRail: 'ethereum',
    currency: 'usdc',
    toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
  },
};

const app = await createApp();
const server = app.getHttpServer();

try {
  const created = await request(server)
    .post('/v1/transfers')
    .set('Authorization', merchant)
    .set('Idempotency-Key', `demo-${body.clientReferenceId}`)
    .send(body);
  if (created.status !== 201) {
    console.error(created.status, created.body);
    process.exitCode = 1;
  } else {
    const states = [created.body.providerState];
    for (let step = 0; step < 3; step += 1) {
      const advanced = await request(server)
        .post(`/operator/fake-provider/transfers/${created.body.id}/advance`)
        .set('Authorization', operator);
      if (advanced.status !== 201) throw new Error(`advance failed: ${advanced.status}`);
      const run = await request(server).post('/operator/reconciliation/run').set('Authorization', operator);
      if (run.status !== 201) throw new Error(`reconcile failed: ${run.status}`);
      const current = await request(server).get(`/v1/transfers/${created.body.id}`).set('Authorization', merchant);
      states.push(current.body.providerState);
    }
    const finalResponse = await request(server).get(`/v1/transfers/${created.body.id}`).set('Authorization', merchant);
    console.log(
      JSON.stringify(
        {
          notice: 'Local fake provider only. No Bridge API call. No settlement.',
          transferId: finalResponse.body.id,
          provider: finalResponse.body.provider,
          settlementAuthority: finalResponse.body.settlementAuthority,
          accountEligibility: finalResponse.body.accountEligibility,
          commercialAvailability: finalResponse.body.commercialAvailability,
          amount: finalResponse.body.amount,
          amountCurrency: finalResponse.body.amountCurrency,
          providerStatesObserved: states,
          normalizedStatus: finalResponse.body.normalizedStatus,
          receiptDestinationTxHash: finalResponse.body.receipt?.destination_tx_hash ?? null,
          depositBankName: finalResponse.body.depositInstructions?.bank_name ?? null,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await app.close();
}
