import { generateKeyPairSync, createSign, createHash } from 'node:crypto';
import { signBridgeWebhook, verifyBridgeWebhookSignature } from './signature.js';

describe('Bridge webhook signature', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const body = Buffer.from('{"event_id":"wh_test","event_category":"transfer"}');
  const now = 1_762_000_000_000;

  it('accepts a double-hash PKCS1 signature over the raw body', () => {
    const header = signBridgeWebhook(privatePem, now, body);
    expect(
      verifyBridgeWebhookSignature(body, header, { publicKeyPem: publicPem, nowMs: () => now }),
    ).toMatchObject({ ok: true, timestampMs: now });
  });

  it('rejects a single-hash signature, which is the mistake the docs warn about', () => {
    const signed = Buffer.concat([Buffer.from(`${now}.`), body]);
    const single = createSign('RSA-SHA256').update(signed).end().sign(privatePem).toString('base64');
    const header = `t=${now},v0=${single}`;
    expect(
      verifyBridgeWebhookSignature(body, header, { publicKeyPem: publicPem, nowMs: () => now }).reason,
    ).toBe('invalid_signature');
  });

  it('rejects a signature over SHA256(raw) passed to a verifier that would hash only once more', () => {
    const digest = createHash('sha256').update(body).digest();
    const signature = createSign('RSA-SHA256').update(digest).end().sign(privatePem).toString('base64');
    expect(
      verifyBridgeWebhookSignature(body, `t=${now},v0=${signature}`, {
        publicKeyPem: publicPem,
        nowMs: () => now,
      }).ok,
    ).toBe(false);
  });

  it('rejects stale, future, tampered, and missing signatures', () => {
    const header = signBridgeWebhook(privatePem, now - 600_001, body);
    expect(
      verifyBridgeWebhookSignature(body, header, { publicKeyPem: publicPem, nowMs: () => now }).reason,
    ).toBe('timestamp_out_of_range');
    const future = signBridgeWebhook(privatePem, now + 300_001, body);
    expect(
      verifyBridgeWebhookSignature(body, future, { publicKeyPem: publicPem, nowMs: () => now }).reason,
    ).toBe('timestamp_out_of_range');
    const ok = signBridgeWebhook(privatePem, now, body);
    const tampered = Buffer.from(body);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x61 ? 0x62 : 0x61;
    expect(
      verifyBridgeWebhookSignature(tampered, ok, { publicKeyPem: publicPem, nowMs: () => now }).reason,
    ).toBe('invalid_signature');
    expect(verifyBridgeWebhookSignature(body, undefined, { publicKeyPem: publicPem }).reason).toBe(
      'missing_header',
    );
  });

  it('does not accept traffic when the public key is unconfigured', () => {
    const header = signBridgeWebhook(privatePem, now, body);
    expect(verifyBridgeWebhookSignature(body, header, { publicKeyPem: null, nowMs: () => now })).toEqual({
      ok: false,
      reason: 'unconfigured',
    });
    expect(verifyBridgeWebhookSignature(body, header, { publicKeyPem: '   ', nowMs: () => now }).reason).toBe(
      'unconfigured',
    );
  });
});
