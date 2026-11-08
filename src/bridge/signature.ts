import { createHash, createPublicKey, createSign, createVerify, timingSafeEqual } from 'node:crypto';

export interface SignatureCheck {
  ok: boolean;
  timestampMs?: number;
  reason?:
    | 'missing_header'
    | 'malformed_header'
    | 'timestamp_out_of_range'
    | 'invalid_signature'
    | 'unconfigured';
}

export interface SignatureOptions {
  publicKeyPem: string | null;
  nowMs?: () => number;
  maxAgeMs?: number;
  futureSkewMs?: number;
}

const DEFAULT_MAX_AGE_MS = 600_000;
const DEFAULT_FUTURE_SKEW_MS = 300_000;

/**
 * Bridge webhook signatures, as documented on 2026-11-07:
 * https://apidocs.bridge.xyz/platform/additional-information/webhooks/signature
 *
 * Header: `X-Webhook-Signature: t=<unix ms>,v0=<base64>`
 * Signed message: SHA256(SHA256(`${timestamp}.${rawBody}`))
 * Algorithm: RSA PKCS#1 v1.5 with SHA-256.
 * Node's verifier hashes once, so it is given the first digest.
 *
 * The 10-minute past window is Bridge's guidance. The future skew is an
 * additional local bound. There is no shared-secret HMAC in this protocol.
 * An empty public key does not verify and must not authorize a mutation.
 */
export function verifyBridgeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  options: SignatureOptions,
): SignatureCheck {
  if (!options.publicKeyPem || options.publicKeyPem.trim() === '') {
    return { ok: false, reason: 'unconfigured' };
  }
  if (!signatureHeader) return { ok: false, reason: 'missing_header' };

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return { ok: false, reason: 'malformed_header' };

  const now = (options.nowMs ?? Date.now)();
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const futureSkew = options.futureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  if (now - parsed.timestampMs > maxAge || parsed.timestampMs - now > futureSkew) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }

  let signature: Buffer;
  try {
    signature = strictBase64Decode(parsed.signature);
  } catch {
    return { ok: false, reason: 'malformed_header' };
  }

  try {
    const digest = firstDigest(parsed.timestampMs, rawBody);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(digest);
    verifier.end();
    const valid = verifier.verify(createPublicKey(options.publicKeyPem), signature);
    return valid ? { ok: true, timestampMs: parsed.timestampMs } : { ok: false, reason: 'invalid_signature' };
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }
}

export function signBridgeWebhook(privateKeyPem: string, timestampMs: number, rawBody: Buffer): string {
  const digest = firstDigest(timestampMs, rawBody);
  const signature = createSign('RSA-SHA256').update(digest).end().sign(privateKeyPem);
  return `t=${timestampMs},v0=${signature.toString('base64')}`;
}

function firstDigest(timestampMs: number, rawBody: Buffer): Buffer {
  const prefix = Buffer.from(`${timestampMs}.`);
  return createHash('sha256').update(Buffer.concat([prefix, rawBody])).digest();
}

function parseSignatureHeader(header: string): { timestampMs: number; signature: string } | null {
  const parts = header.split(',');
  let timestamp: string | undefined;
  let signature: string | undefined;
  for (const part of parts) {
    if (part.startsWith('t=') && timestamp === undefined) timestamp = part.slice(2);
    else if (part.startsWith('v0=') && signature === undefined) signature = part.slice(3);
    else return null;
  }
  if (!timestamp || !signature) return null;
  if (!/^\d{1,16}$/.test(timestamp)) return null;
  const timestampMs = Number(timestamp);
  if (!Number.isSafeInteger(timestampMs)) return null;
  return { timestampMs, signature };
}

function strictBase64Decode(input: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input) || input.length % 4 !== 0) {
    throw new Error('malformed base64');
  }
  const decoded = Buffer.from(input, 'base64');
  const roundTrip = decoded.toString('base64');
  const left = Buffer.from(roundTrip);
  const right = Buffer.from(input);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error('malformed base64');
  }
  return decoded;
}
