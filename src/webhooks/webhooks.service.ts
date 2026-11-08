import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { APP_CONFIG, Actor } from '../auth/actor.js';
import { AppConfig } from '../config/env.js';
import { verifyBridgeWebhookSignature } from '../bridge/signature.js';
import { parseProviderTransfer } from '../bridge/parse-transfer.js';
import { ProviderCallError } from '../bridge/types.js';
import { AppError, isDuplicateKey } from '../common/errors.js';
import { randomId } from '../common/ids.js';
import { AuditRecordEntity, WebhookEventEntity } from '../persistence/entities.js';
import { TransfersService } from '../transfers/transfers.service.js';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TransfersService) private readonly transfers: TransfersService,
  ) {}

  async handle(rawBody: Buffer, signatureHeader: string | undefined): Promise<{ received: true; duplicate: boolean; result: string }> {
    const verification = verifyBridgeWebhookSignature(rawBody, signatureHeader, {
      publicKeyPem: this.config.webhook.publicKeyPem,
      maxAgeMs: this.config.webhook.maxAgeMs,
      futureSkewMs: this.config.webhook.futureSkewMs,
    });
    if (!verification.ok) {
      await this.audit(verification.reason === 'unconfigured' ? 'webhook_blocked_unconfigured' : 'webhook_rejected');
      if (verification.reason === 'unconfigured') {
        throw new AppError(
          503,
          'webhook_verification_unconfigured',
          'Webhook verification is not configured. No transfer was changed.',
        );
      }
      throw new AppError(400, 'webhook_signature_rejected', 'Webhook signature was rejected.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8')) as unknown;
    } catch {
      throw new AppError(400, 'webhook_malformed', 'Webhook body is not JSON.');
    }
    const event = readEvent(parsed);
    if (!event) throw new AppError(400, 'webhook_malformed', 'Webhook event identity is missing or invalid.');

    const payloadSha256 = createHash('sha256').update(rawBody).digest('hex');
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rowId = randomId();
        await manager.insert(WebhookEventEntity, {
          id: rowId,
          eventId: event.eventId,
          eventCategory: event.category,
          eventType: event.type,
          eventObjectId: event.objectId,
          eventSequence: event.sequence === null ? null : String(event.sequence),
          eventCreatedAt: event.createdAtMs === null ? null : new Date(event.createdAtMs),
          signatureTimestampMs: String(verification.timestampMs ?? 0),
          payloadSha256,
          processingResult: 'received',
          transferId: null,
          createdAt: new Date(),
        });

        if (event.category !== 'transfer') {
          await manager.update(WebhookEventEntity, { id: rowId }, { processingResult: 'ignored_category' });
          return { received: true as const, duplicate: false, result: 'ignored_category' };
        }

        let observed;
        try {
          observed = parseProviderTransfer(event.object);
        } catch (error) {
          if (!(error instanceof ProviderCallError)) throw error;
          await manager.update(WebhookEventEntity, { id: rowId }, { processingResult: 'unparsed_transfer' });
          return { received: true as const, duplicate: false, result: 'unparsed_transfer' };
        }
        if (event.objectStatus && event.objectStatus !== observed.state) {
          await manager.update(WebhookEventEntity, { id: rowId }, { processingResult: 'status_mismatch' });
          return { received: true as const, duplicate: false, result: 'status_mismatch' };
        }
        const applied = await this.transfers.applyObservation(manager, {
          providerTransferId: observed.id,
          observed,
          cause: 'webhook',
          eventSequence: event.sequence,
          eventCreatedAtMs: event.createdAtMs,
          eventId: event.eventId,
          actor: { role: 'operator', merchantId: null },
          requestId: null,
        });
        await manager.update(WebhookEventEntity, { id: rowId }, {
          processingResult: applied.result,
          transferId: applied.transferId,
        });
        return { received: true as const, duplicate: false, result: applied.result };
      });
    } catch (error) {
      if (isDuplicateKey(error)) return { received: true, duplicate: true, result: 'duplicate' };
      throw error;
    }
  }

  private async audit(action: string): Promise<void> {
    await this.dataSource.getRepository(AuditRecordEntity).insert({
      actorRole: 'webhook',
      actorId: null,
      action,
      resourceType: 'webhook',
      resourceId: null,
      requestId: null,
      metadata: null,
      createdAt: new Date(),
    });
  }
}

function readEvent(value: unknown): {
  eventId: string;
  category: string;
  type: string;
  objectId: string | null;
  sequence: number | null;
  createdAtMs: number | null;
  objectStatus: string | null;
  object: unknown;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.event_id !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(record.event_id)) return null;
  if (typeof record.event_category !== 'string' || !/^[a-z0-9._]{1,64}$/.test(record.event_category)) return null;
  if (typeof record.event_type !== 'string' || record.event_type.length > 128) return null;
  const objectId = typeof record.event_object_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(record.event_object_id)
    ? record.event_object_id
    : null;
  let sequence: number | null = null;
  if (typeof record.event_sequence === 'number' && Number.isSafeInteger(record.event_sequence) && record.event_sequence >= 0) {
    sequence = record.event_sequence;
  }
  let createdAtMs: number | null = null;
  if (typeof record.event_created_at === 'string') {
    const parsed = Date.parse(record.event_created_at);
    if (Number.isFinite(parsed)) createdAtMs = parsed;
  }
  const objectStatus = typeof record.event_object_status === 'string' ? record.event_object_status : null;
  return {
    eventId: record.event_id,
    category: record.event_category,
    type: record.event_type,
    objectId,
    sequence,
    createdAtMs,
    objectStatus,
    object: record.event_object,
  };
}
