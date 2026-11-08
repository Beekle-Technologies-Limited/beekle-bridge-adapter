import { createHash, randomUUID } from 'node:crypto';

const NAMESPACE = Buffer.from('b8d1c5a27e345b909c1a000000000001', 'hex');

export function randomId(): string {
  return randomUUID();
}

export function outboundIdempotencyKey(merchantId: string, idempotencyKey: string): string {
  return uuidV5(`${merchantId}:${idempotencyKey}`);
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function uuidV5(name: string): string {
  const hash = createHash('sha1').update(NAMESPACE).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
