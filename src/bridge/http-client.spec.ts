import { readFileSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BridgeHttpClient } from './http-client.js';
import { ProviderCallError } from './types.js';

const achOnramp = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/ach-onramp.response.json'), 'utf8'),
) as {
  id: string;
};

describe('Bridge HTTP client against the documented fixture', () => {
  let server: Server;
  let baseUrl = '';
  const seen: Array<{ method: string; url: string; idempotencyKey: string | undefined; apiKey: string | undefined; body: string }> = [];
  let script: Array<{ status: number; body: unknown; hang?: boolean }> = [];

  beforeEach(async () => {
    seen.length = 0;
    script = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk as Buffer));
      req.on('end', () => {
        const step = script.shift();
        seen.push({
          method: req.method ?? '',
          url: req.url ?? '',
          idempotencyKey: req.headers['idempotency-key'] as string | undefined,
          apiKey: req.headers['api-key'] as string | undefined,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        if (!step || step.hang) return;
        res.writeHead(step.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(step.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}/v0`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  function client(maxAttempts = 3, timeoutMs = 1000): BridgeHttpClient {
    const port = new URL(baseUrl).port;
    return new BridgeHttpClient({
      baseUrl,
      apiKey: 'sk-test-fixture-only',
      timeoutMs,
      maxAttempts,
      allowProduction: false,
      environment: 'sandbox',
      fixtureOrigin: `http://127.0.0.1:${port}`,
      sleep: async () => undefined,
      random: () => 0,
    });
  }

  it('posts the documented create contract and keeps the decimal amount as a string', async () => {
    script.push({ status: 201, body: achOnramp });
    const transfer = await client().createTransfer({
      outboundIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      amount: '75.0',
      onBehalfOf: '00000000-0000-0000-0000-000000000001',
      developerFee: null,
      clientReferenceId: 'client_transfer_id_123',
      source: { paymentRail: 'ach_push', currency: 'usd' },
      destination: {
        paymentRail: 'ethereum',
        currency: 'usdc',
        toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toBe('/v0/transfers');
    expect(seen[0].idempotencyKey).toBe('11111111-1111-4111-8111-111111111111');
    expect(seen[0].apiKey).toBe('sk-test-fixture-only');
    expect(JSON.parse(seen[0].body)).toMatchObject({
      amount: '75.0',
      on_behalf_of: '00000000-0000-0000-0000-000000000001',
      source: { payment_rail: 'ach_push', currency: 'usd' },
      destination: { payment_rail: 'ethereum', currency: 'usdc' },
    });
    expect(transfer.amount).toBe('75.0');
    expect(transfer.state).toBe('awaiting_funds');
    expect(transfer.depositInstructions?.bank_account_number).toBe('1234567890');
    expect(transfer.receipt?.final_amount).toBe('75.0');
    expect(JSON.stringify(transfer)).not.toContain('ACH description');
  });

  it('retries 409 resource_state_conflict with the same idempotency key and does not retry 400', async () => {
    script.push(
      { status: 409, body: { code: 'resource_state_conflict', message: 'busy and this message must not leak' } },
      { status: 201, body: achOnramp },
    );
    const transfer = await client().createTransfer({
      outboundIdempotencyKey: 'same-key',
      amount: '75.0',
      onBehalfOf: 'cust_alice',
      developerFee: null,
      clientReferenceId: null,
      source: { paymentRail: 'ach_push', currency: 'usd' },
      destination: {
        paymentRail: 'ethereum',
        currency: 'usdc',
        toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
    });
    expect(transfer.id).toBe(achOnramp.id);
    expect(seen.map((call) => call.idempotencyKey)).toEqual(['same-key', 'same-key']);

    seen.length = 0;
    script.push({ status: 400, body: { code: 'bad_customer_request', message: 'ssn and other identity text' } });
    await expect(
      client().createTransfer({
        outboundIdempotencyKey: 'other-key',
        amount: '75.0',
        onBehalfOf: 'cust_alice',
        developerFee: null,
        clientReferenceId: null,
        source: { paymentRail: 'ach_push', currency: 'usd' },
        destination: {
          paymentRail: 'ethereum',
          currency: 'usdc',
          toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        },
      }),
    ).rejects.toMatchObject({ status: 400, code: 'bad_customer_request' });
    expect(seen).toHaveLength(1);
  });

  it('does not send an idempotency key on GET and rejects redirects', async () => {
    script.push({ status: 200, body: achOnramp });
    await client().getTransfer(achOnramp.id);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].idempotencyKey).toBeUndefined();
    expect(seen[0].url).toBe(`/v0/transfers/${achOnramp.id}`);

    seen.length = 0;
    script.push({ status: 302, body: { code: 'unexpected' } });
    await expect(client().getTransfer(achOnramp.id)).rejects.toMatchObject({ code: 'provider_redirect_rejected' });
  });

  it('posts dry_run and parses the documented route response', async () => {
    script.push({ status: 201, body: { state: 'valid', notes: ['This is a valid transfer route'] } });
    const result = await client().dryRun({
      outboundIdempotencyKey: 'dry-run-key',
      amount: '75.0',
      onBehalfOf: 'cust_alice',
      developerFee: null,
      clientReferenceId: null,
      source: { paymentRail: 'ach_push', currency: 'usd' },
      destination: {
        paymentRail: 'ethereum',
        currency: 'usdc',
        toAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
      },
      dryRun: true,
    });
    expect(result).toEqual({ state: 'valid', notes: ['This is a valid transfer route'] });
    expect(JSON.parse(seen[0].body).dry_run).toBe(true);
    expect(seen[0].idempotencyKey).toBe('dry-run-key');
  });

  it('times out a hanging socket without retrying past the attempt cap', async () => {
    script.push({ status: 200, body: achOnramp, hang: true });
    const started = Date.now();
    await expect(client(2, 200).getTransfer(achOnramp.id)).rejects.toMatchObject({ code: 'provider_unreachable' });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(seen.length).toBe(2);
  });
});
