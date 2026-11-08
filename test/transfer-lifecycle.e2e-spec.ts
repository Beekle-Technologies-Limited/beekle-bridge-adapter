import { generateKeyPairSync } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { signBridgeWebhook } from '../src/bridge/signature.js';
import { createApp } from '../src/main.js';

const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privatePem = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const merchant = 'Bearer test-merchant-key';
const operator = 'Bearer test-operator-key';

describe('fake provider transfer lifecycle', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.BRIDGE_PROVIDER = 'fake';
    process.env.BRIDGE_WEBHOOK_PUBLIC_KEY = publicPem;
    process.env.DATABASE_NAME = 'beekle_bridge_test';
    process.env.RECONCILE_INTERVAL_MS = '0';
    app = await createApp();
  });

  beforeEach(async () => {
    const dataSource = app.get(DataSource);
    await dataSource.query('SET FOREIGN_KEY_CHECKS=0');
    for (const table of [
      'state_transitions',
      'webhook_events',
      'audit_records',
      'reconciliation_runs',
      'fake_provider_transfers',
      'transfers',
    ]) {
      await dataSource.query(`TRUNCATE TABLE ${table}`);
    }
    await dataSource.query('SET FOREIGN_KEY_CHECKS=1');
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates, reconciles a fake advance, and does not treat it as Bridge settlement', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'order-250-a')
      .send(transferBody())
      .expect(201);

    expect(created.body.amount).toBe('250.00');
    expect(created.body.provider).toBe('fake');
    expect(created.body.settlementAuthority).toBe('local_fake_not_bridge');
    expect(created.body.accountEligibility).toBe('unknown');
    expect(created.body.commercialAvailability).toBe('unconfirmed');
    expect(created.body.providerState).toBe('awaiting_funds');
    expect(created.body.normalizedStatus).toBe('awaiting_funds');
    expect(created.body.depositInstructions.bank_name).toContain('NOT A BANK');
    expect(created.body.depositInstructions.bank_account_number).toBeUndefined();
    expect(created.body.depositInstructionStorage).toBe('redacted_not_encrypted');
    expect(created.body.complianceVerifier).toBe('local_demo_not_a_compliance_gate');
    expect(typeof created.body.amount).toBe('string');

    const replay = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'order-250-a')
      .send(transferBody())
      .expect(201);
    expect(replay.body.id).toBe(created.body.id);

    await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'order-250-a')
      .send({ ...transferBody(), amount: '251.00' })
      .expect(422);

    const advanced = await request(app.getHttpServer())
      .post(`/operator/fake-provider/transfers/${created.body.id}/advance`)
      .set('Authorization', operator)
      .expect(201);
    expect(advanced.body.settlementAuthority).toBe('local_fake_not_bridge');
    expect(advanced.body.providerState).toBe('funds_received');
    expect(advanced.body.localTransferUnchangedUntilReconciliation).toBe(true);

    const before = await request(app.getHttpServer())
      .get(`/v1/transfers/${created.body.id}`)
      .set('Authorization', merchant)
      .expect(200);
    expect(before.body.providerState).toBe('awaiting_funds');

    const run = await request(app.getHttpServer())
      .post('/operator/reconciliation/run')
      .set('Authorization', operator)
      .expect(201);
    expect(run.body.updatesApplied).toBe(1);

    const after = await request(app.getHttpServer())
      .get(`/v1/transfers/${created.body.id}`)
      .set('Authorization', merchant)
      .expect(200);
    expect(after.body.providerState).toBe('funds_received');
    expect(after.body.normalizedStatus).toBe('funds_received');

    const audit = await request(app.getHttpServer()).get('/operator/audit').set('Authorization', operator).expect(200);
    expect(JSON.stringify(audit.body)).not.toContain('0000000000');
    expect(JSON.stringify(audit.body)).not.toContain('sk-test');

    const fetched = await request(app.getHttpServer())
      .get(`/v1/transfers/${created.body.id}/deposit-instructions`)
      .set('Authorization', merchant)
      .expect(200);
    expect(fetched.body.persisted).toBe(false);
    expect(fetched.body.instructions.bank_account_number).toBe('0000000000');
    const stored = await app.get(DataSource).query('SELECT deposit_instructions, payload FROM transfers t LEFT JOIN fake_provider_transfers f ON f.provider_transfer_id = t.provider_transfer_id');
    expect(JSON.stringify(stored)).not.toContain('0000000000');
  });

  it('verifies a raw-body webhook, ignores duplicates and regressions, and blocks when unsigned', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'order-250-b')
      .send(transferBody('order-250-b'))
      .expect(201);

    const event = webhookEvent(created.body.providerTransferId, 'wh_funds_1', 2, 'funds_received');
    const raw = Buffer.from(JSON.stringify(event));
    const now = Date.now();
    const header = signBridgeWebhook(privatePem, now, raw);
    const first = await request(app.getHttpServer())
      .post('/webhooks/bridge')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', header)
      .send(raw.toString('utf8'))
      .expect(201);
    expect(first.body.result).toBe('applied');

    const duplicate = await request(app.getHttpServer())
      .post('/webhooks/bridge')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signBridgeWebhook(privatePem, Date.now(), raw))
      .send(raw.toString('utf8'))
      .expect(201);
    expect(duplicate.body.duplicate).toBe(true);

    const stale = webhookEvent(created.body.providerTransferId, 'wh_old_1', 1, 'awaiting_funds');
    const staleRaw = Buffer.from(JSON.stringify(stale));
    const staleResponse = await request(app.getHttpServer())
      .post('/webhooks/bridge')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', signBridgeWebhook(privatePem, Date.now(), staleRaw))
      .send(staleRaw.toString('utf8'))
      .expect(201);
    expect(staleResponse.body.result).toBe('stale_sequence');

    const current = await request(app.getHttpServer())
      .get(`/v1/transfers/${created.body.id}`)
      .set('Authorization', merchant)
      .expect(200);
    expect(current.body.providerState).toBe('funds_received');

    await request(app.getHttpServer())
      .post('/webhooks/bridge')
      .set('Content-Type', 'application/json')
      .send(raw.toString('utf8'))
      .expect(400);

    const rows = await app.get(DataSource).query('SELECT event_id, payload_sha256, processing_result FROM webhook_events');
    expect(JSON.stringify(rows)).not.toContain('originator_name');
    expect(JSON.stringify(rows)).not.toContain('Jane Q Customer');
    const storedInstructions = await app.get(DataSource).query('SELECT deposit_instructions FROM transfers');
    expect(JSON.stringify(storedInstructions)).not.toContain('999888777');
  });

  it('rejects unsupported currencies and Stellar before any provider write', async () => {
    const stellar = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'stellar-blocked')
      .send({
        ...transferBody(),
        destination: { paymentRail: 'stellar', currency: 'usdc', toAddress: 'GABCD123456789' },
      })
      .expect(422);
    expect(stellar.body.error.code).toBe('stellar_route_not_orchestrated');

    const ghs = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'ghs-blocked')
      .send({
        ...transferBody(),
        source: { paymentRail: 'ach_push', currency: 'ghs' },
      })
      .expect(422);
    expect(ghs.body.error.code).toBe('currency_not_in_bridge_transfer_schema');

    const count = await app.get(DataSource).query('SELECT COUNT(*) AS count FROM fake_provider_transfers');
    expect(Number(count[0].count)).toBe(0);
  });

  it('rejects a correlation string that is not an explicit local demo approval', async () => {
    const rejected = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'not-an-approval')
      .send({ ...transferBody('not-an-approval'), complianceDecisionRef: 'dec_just_a_correlation' })
      .expect(403);
    expect(rejected.body.error.code).toBe('compliance_decision_not_approved');
    const rows = await app
      .get(DataSource)
      .query("SELECT COUNT(*) AS count FROM transfers WHERE client_reference_id = 'not-an-approval'");
    expect(Number(rows[0].count)).toBe(0);
  });
});

describe('webhook verification disabled', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.BRIDGE_WEBHOOK_PUBLIC_KEY;
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not mutate transfers when the public key is absent', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/transfers')
      .set('Authorization', merchant)
      .set('Idempotency-Key', 'order-no-webhook')
      .send(transferBody('order-no-webhook'))
      .expect(201);
    await request(app.getHttpServer())
      .post('/webhooks/bridge')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', 't=1,v0=aaaa')
      .send('{"event_id":"wh_ignored"}')
      .expect(503);
    const current = await request(app.getHttpServer())
      .get(`/v1/transfers/${created.body.id}`)
      .set('Authorization', merchant)
      .expect(200);
    expect(current.body.providerState).toBe('awaiting_funds');
  });
});

function transferBody(reference = 'order-250') {
  return {
    complianceDecisionRef: 'dec_local_demo',
    onBehalfOf: 'cust_local_demo',
    clientReferenceId: reference,
    amount: '250.00',
    source: { paymentRail: 'ach_push', currency: 'usd' },
    destination: {
      paymentRail: 'ethereum',
      currency: 'usdc',
      toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    },
  };
}

function webhookEvent(providerTransferId: string, eventId: string, sequence: number, state: string) {
  return {
    api_version: 'v0',
    event_id: eventId,
    event_sequence: sequence,
    event_category: 'transfer',
    event_type: 'transfer.updated.status_transitioned',
    event_object_id: providerTransferId,
    event_object_status: state,
    event_created_at: new Date().toISOString(),
    event_object: {
      id: providerTransferId,
      state,
      amount: '250.00',
      developer_fee: '0.0',
      on_behalf_of: 'cust_local_demo',
      source: { payment_rail: 'ach_push', currency: 'usd', originator_name: 'Jane Q Customer' },
      destination: {
        payment_rail: 'ethereum',
        currency: 'usdc',
        to_address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
      source_deposit_instructions: {
        payment_rail: 'ach_push',
        amount: '250.00',
        currency: 'usd',
        bank_account_number: '999888777',
        bank_name: 'Bank name',
      },
      updated_at: new Date().toISOString(),
    },
  };
}
