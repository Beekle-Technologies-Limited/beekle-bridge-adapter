import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, MoreThan, Repository } from 'typeorm';
import { Actor } from '../auth/actor.js';
import { redactDepositInstructions } from '../bridge/deposit-instructions.js';
import { endpointTokenError } from '../bridge/create-body.js';
import { BRIDGE_PROVIDER, BridgeTransferProvider } from '../bridge/provider.js';
import { decideTransition } from '../bridge/state-machine.js';
import { normalizeProviderState } from '../bridge/status.js';
import { CreateProviderTransfer, ProviderCallError, ProviderTransfer } from '../bridge/types.js';
import { endpointFieldErrors, evaluateRoute } from '../capabilities/route-policy.js';
import { COMPLIANCE_VERIFIER, ComplianceApprovalVerifier, PositiveComplianceDecision } from '../compliance/approval-verifier.js';
import { AppError, isDuplicateKey } from '../common/errors.js';
import { outboundIdempotencyKey, randomId, sha256 } from '../common/ids.js';
import { compareDecimal } from '../money/decimal-string.js';
import { AuditRecordEntity, StateTransitionEntity, TransferEntity } from '../persistence/entities.js';
import { CreateTransferDto } from './dto.js';

const ACTIVE_STATUSES = [
  'awaiting_funds',
  'in_review',
  'funds_received',
  'payment_submitted',
  'undeliverable',
  'returned',
  'missing_return_policy',
  'refund_in_flight',
  'refund_failed',
  'error',
  'compliance_hold',
  'unknown_provider_state',
];

export interface TransferView {
  id: string;
  merchantId: string;
  complianceDecisionRef: string;
  clientReferenceId: string | null;
  onBehalfOf: string;
  amount: string;
  developerFee: string | null;
  amountCurrency: string;
  source: {
    paymentRail: string;
    currency: string;
    fromAddress: string | null;
    bridgeWalletId: string | null;
  };
  destination: {
    paymentRail: string;
    currency: string;
    toAddress: string | null;
    externalAccountId: string | null;
    reference: string | null;
  };
  provider: string;
  providerTransferId: string | null;
  providerState: string | null;
  normalizedStatus: string;
  submissionStatus: string;
  failureCode: string | null;
  depositInstructions: Record<string, string> | null;
  depositInstructionStorage: 'redacted_not_encrypted';
  receipt: Record<string, string> | null;
  documentedMinimum: string | null;
  capabilityCode: string;
  complianceVerifier: string;
  accountEligibility: 'unknown';
  commercialAvailability: 'unconfirmed';
  settlementAuthority: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(TransferEntity) private readonly transfers: Repository<TransferEntity>,
    @Inject(BRIDGE_PROVIDER) private readonly provider: BridgeTransferProvider,
    @Inject(COMPLIANCE_VERIFIER) private readonly compliance: ComplianceApprovalVerifier,
  ) {}

  async create(actor: Actor, idempotencyKey: string, dto: CreateTransferDto, requestId: string): Promise<TransferView> {
    if (actor.role !== 'merchant' || !actor.merchantId) {
      throw new AppError(403, 'merchant_actor_required', 'Create a transfer with a merchant credential.');
    }
    const evaluation = evaluateRoute({
      sourceRail: dto.source.paymentRail,
      sourceCurrency: dto.source.currency,
      destinationRail: dto.destination.paymentRail,
      destinationCurrency: dto.destination.currency,
      amount: dto.amount,
    });
    if (!evaluation.accepted || !evaluation.amountCurrency) {
      throw new AppError(422, evaluation.code, evaluation.message, {
        apiSchemaSupport: evaluation.apiSchemaSupport,
        routeExplorer: evaluation.routeExplorer,
        accountEligibility: 'unknown',
        commercialAvailability: 'unconfirmed',
        minimum: evaluation.minimum,
      });
    }
    const fieldError = endpointFieldErrors({
      sourceRail: dto.source.paymentRail,
      sourceCurrency: dto.source.currency,
      destinationRail: dto.destination.paymentRail,
      destinationCurrency: dto.destination.currency,
      fromAddress: dto.source.fromAddress,
      toAddress: dto.destination.toAddress,
      externalAccountId: dto.destination.externalAccountId,
      bridgeWalletId: dto.source.bridgeWalletId,
      senderReturnUrl: dto.source.senderReturnUrl,
      reference: dto.destination.reference,
    });
    if (fieldError) throw new AppError(400, fieldError, 'The transfer fields do not match the selected rails.');
    if (dto.developerFee && compareDecimal(dto.developerFee, dto.amount) >= 0) {
      throw new AppError(422, 'fee_exceeds_amount', 'developerFee must be a decimal string lower than amount.');
    }
    const command = toCommand(dto, outboundIdempotencyKey(actor.merchantId, idempotencyKey));
    const tokenError = endpointTokenError(command);
    if (tokenError) throw new AppError(400, tokenError, 'A transfer field failed the documented format check.');
    const approval = await this.compliance.verify({
      merchantId: actor.merchantId,
      decisionRef: dto.complianceDecisionRef,
      onBehalfOf: dto.onBehalfOf,
      amount: dto.amount,
      amountCurrency: evaluation.amountCurrency,
      sourceRail: dto.source.paymentRail,
      sourceCurrency: dto.source.currency,
      destinationRail: dto.destination.paymentRail,
      destinationCurrency: dto.destination.currency,
    });

    const requestHash = canonicalHash(actor.merchantId, dto);
    let transfer = await this.transfers.findOne({
      where: { merchantId: actor.merchantId, idempotencyKey },
    });
    if (!transfer) {
      try {
        transfer = await this.insertSubmitting(
          actor.merchantId,
          idempotencyKey,
          requestHash,
          command,
          dto,
          evaluation,
          approval,
          requestId,
        );
      } catch (error) {
        if (!isDuplicateKey(error)) throw error;
        transfer = await this.transfers.findOne({ where: { merchantId: actor.merchantId, idempotencyKey } });
        if (!transfer) throw error;
      }
    }
    if (transfer.requestHash !== requestHash) {
      throw new AppError(422, 'idempotency_mismatch', 'This idempotency key was already used for a different request.');
    }
    if (transfer.submissionStatus === 'accepted') return toView(transfer, 'merchant');
    if (transfer.submissionStatus === 'submit_failed') {
      throw new AppError(
        422,
        transfer.failureCode ?? 'provider_rejected',
        'The original submission failed. Use a new idempotency key for a different attempt.',
      );
    }

    try {
      const observed = await this.provider.createTransfer(command);
      await this.markAccepted(transfer.id, observed, actor, requestId);
    } catch (error) {
      if (!(error instanceof ProviderCallError)) throw error;
      const mapped = mapProviderError(error);
      if (!isRetryable(error)) await this.markFailed(transfer.id, mapped.code, actor, requestId);
      throw mapped;
    }
    const fresh = await this.transfers.findOneByOrFail({ id: transfer.id });
    return toView(fresh, 'merchant');
  }

  async get(actor: Actor, id: string): Promise<TransferView> {
    const transfer = await this.owned(actor, id);
    return toView(transfer, actor.role === 'operator' ? 'operator' : 'merchant');
  }

  async list(actor: Actor): Promise<TransferView[]> {
    const where = actor.role === 'merchant' ? { merchantId: actor.merchantId ?? '' } : {};
    const rows = await this.transfers.find({ where, order: { createdAt: 'DESC' }, take: 50 });
    const audience = actor.role === 'operator' ? 'operator' : 'merchant';
    return rows.map((row) => toView(row, audience));
  }

  async cancel(actor: Actor, id: string, requestId: string): Promise<TransferView> {
    const existing = await this.owned(actor, id);
    if (existing.providerState !== 'awaiting_funds' || !existing.providerTransferId) {
      throw new AppError(409, 'cancel_not_allowed', 'Cancellation is only available from awaiting_funds.');
    }
    let observed: ProviderTransfer | null;
    try {
      observed = await this.provider.deleteTransfer(existing.providerTransferId);
    } catch (error) {
      if (error instanceof ProviderCallError) throw mapProviderError(error);
      throw error;
    }
    const next = observed ?? syntheticCancel(existing);
    await this.transfers.manager.transaction(async (manager) => {
      await this.applyObservation(manager, {
        providerTransferId: existing.providerTransferId as string,
        observed: next,
        cause: 'cancel',
        eventSequence: null,
        eventCreatedAtMs: null,
        eventId: null,
        actor,
        requestId,
      });
    });
    const fresh = await this.transfers.findOneByOrFail({ id: existing.id });
    if (fresh.providerState !== 'canceled') {
      throw new AppError(409, 'provider_cancel_not_confirmed', 'The provider did not confirm cancellation.');
    }
    return toView(fresh, actor.role === 'operator' ? 'operator' : 'merchant');
  }

  async candidatesForReconciliation(now: Date): Promise<TransferEntity[]> {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return this.transfers.find({
      where: [
        { submissionStatus: 'accepted', normalizedStatus: In(ACTIVE_STATUSES) },
        { submissionStatus: 'accepted', normalizedStatus: 'completed', updatedAt: MoreThan(cutoff) },
      ],
      order: { updatedAt: 'ASC' },
      take: 50,
    });
  }

  async applyObservation(
    manager: EntityManager,
    input: {
      providerTransferId: string;
      observed: ProviderTransfer;
      cause: 'webhook' | 'reconciliation' | 'cancel';
      eventSequence: number | null;
      eventCreatedAtMs: number | null;
      eventId: string | null;
      actor: Actor;
      requestId: string | null;
    },
  ): Promise<{ result: string; transferId: string | null }> {
    const transfer = await manager.findOne(TransferEntity, {
      where: { providerTransferId: input.providerTransferId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!transfer) return { result: 'unmatched', transferId: null };
    const decision = decideTransition({
      current: transfer.providerState,
      next: input.observed.state,
      currentSequence: toNumber(transfer.lastEventSequence),
      nextSequence: input.eventSequence,
      currentEventCreatedAtMs: transfer.lastEventCreatedAt ? transfer.lastEventCreatedAt.getTime() : null,
      nextEventCreatedAtMs: input.eventCreatedAtMs,
    });
    if (!decision.apply) return { result: decision.reason, transferId: transfer.id };

    const fromProvider = transfer.providerState;
    const fromNormalized = transfer.normalizedStatus;
    transfer.providerState = input.observed.state;
    transfer.normalizedStatus = normalizeProviderState(input.observed.state);
    if (input.observed.depositInstructions) {
      transfer.depositInstructions = redactDepositInstructions(input.observed.depositInstructions);
    }
    if (input.observed.receipt) transfer.receipt = input.observed.receipt;
    transfer.updatedAt = new Date();
    if (input.eventSequence !== null) transfer.lastEventSequence = String(input.eventSequence);
    if (input.eventCreatedAtMs !== null) transfer.lastEventCreatedAt = new Date(input.eventCreatedAtMs);
    if (input.cause === 'reconciliation') transfer.lastReconciledAt = transfer.updatedAt;
    await manager.save(transfer);
    await manager.save(
      manager.create(StateTransitionEntity, {
        transferId: transfer.id,
        fromProviderState: fromProvider,
        toProviderState: transfer.providerState,
        fromNormalized,
        toNormalized: transfer.normalizedStatus,
        reason: 'provider_observation',
        cause: input.cause,
        eventId: input.eventId,
        createdAt: transfer.updatedAt,
      }),
    );
    await this.audit(manager, input.actor, 'transfer_state_applied', transfer.id, input.requestId, {
      cause: input.cause,
      providerState: transfer.providerState,
      normalizedStatus: transfer.normalizedStatus,
    });
    return { result: 'applied', transferId: transfer.id };
  }

  async depositInstructions(actor: Actor, id: string, requestId: string): Promise<{
    transferId: string;
    persisted: false;
    storage: 'not_stored';
    instructions: Record<string, string> | null;
  }> {
    if (actor.role !== 'merchant') {
      throw new AppError(403, 'merchant_actor_required', 'Deposit instructions are returned only to the owning merchant.');
    }
    const transfer = await this.owned(actor, id);
    if (!transfer.providerTransferId || transfer.submissionStatus !== 'accepted') {
      throw new AppError(409, 'transfer_not_submitted', 'The provider has no instructions for this transfer yet.');
    }
    let observed: ProviderTransfer;
    try {
      observed = await this.provider.getTransfer(transfer.providerTransferId);
    } catch (error) {
      if (error instanceof ProviderCallError) throw mapProviderError(error);
      throw error;
    }
    await this.audit(this.transfers.manager, actor, 'deposit_instructions_fetched', transfer.id, requestId, {
      persisted: false,
      sensitiveFieldCount: observed.depositInstructions
        ? Object.keys(observed.depositInstructions).filter((key) => key.includes('account') || key.includes('routing') || key.includes('iban')).length
        : 0,
    });
    return {
      transferId: transfer.id,
      persisted: false,
      storage: 'not_stored',
      instructions: observed.depositInstructions,
    };
  }

  private async insertSubmitting(
    merchantId: string,
    idempotencyKey: string,
    requestHash: string,
    command: CreateProviderTransfer,
    dto: CreateTransferDto,
    evaluation: { minimum: string | null; code: string; amountCurrency: string | null },
    approval: PositiveComplianceDecision,
    requestId: string,
  ): Promise<TransferEntity> {
    const now = new Date();
    const entity = this.transfers.create({
      id: randomId(),
      merchantId,
      complianceDecisionRef: dto.complianceDecisionRef,
      complianceVerifier: approval.verifier,
      clientReferenceId: dto.clientReferenceId ?? null,
      idempotencyKey,
      requestHash,
      outboundIdempotencyKey: command.outboundIdempotencyKey,
      bridgeCustomerId: dto.onBehalfOf,
      amountDecimal: dto.amount,
      developerFeeDecimal: dto.developerFee ?? null,
      amountCurrency: evaluation.amountCurrency ?? 'usd',
      sourcePaymentRail: dto.source.paymentRail,
      sourceCurrency: dto.source.currency,
      sourceFromAddress: dto.source.fromAddress ?? null,
      sourceBridgeWalletId: dto.source.bridgeWalletId ?? null,
      sourceReturnUrl: dto.source.senderReturnUrl ?? null,
      destinationPaymentRail: dto.destination.paymentRail,
      destinationCurrency: dto.destination.currency,
      destinationToAddress: dto.destination.toAddress ?? null,
      destinationExternalAccountId: dto.destination.externalAccountId ?? null,
      destinationReference: dto.destination.reference ?? null,
      provider: this.provider.mode,
      providerTransferId: null,
      providerState: null,
      normalizedStatus: 'submitting',
      submissionStatus: 'submitting',
      failureCode: null,
      lastEventSequence: null,
      lastEventCreatedAt: null,
      depositInstructions: null,
      receipt: null,
      documentedMinimum: evaluation.minimum,
      capabilityCode: evaluation.code,
      accountEligibility: 'unknown',
      commercialAvailability: 'unconfirmed',
      settlementAuthority: this.provider.settlementAuthority,
      createdAt: now,
      updatedAt: now,
      lastReconciledAt: null,
    });
    await this.transfers.manager.transaction(async (manager) => {
      await manager.insert(TransferEntity, entity);
      await this.audit(manager, { role: 'merchant', merchantId }, 'transfer_submit_started', entity.id, requestId, {
        capabilityCode: evaluation.code,
        provider: this.provider.mode,
      });
    });
    return entity;
  }

  private async markAccepted(id: string, observed: ProviderTransfer, actor: Actor, requestId: string): Promise<void> {
    await this.transfers.manager.transaction(async (manager) => {
      const transfer = await manager.findOne(TransferEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!transfer) throw new AppError(500, 'internal_error', 'Internal error');
      if (transfer.submissionStatus === 'accepted') {
        if (transfer.providerTransferId !== observed.id) {
          throw new AppError(409, 'provider_id_conflict', 'The provider returned a different id for this idempotency key.');
        }
        return;
      }
      transfer.submissionStatus = 'accepted';
      transfer.failureCode = null;
      transfer.providerTransferId = observed.id;
      transfer.providerState = observed.state;
      transfer.normalizedStatus = normalizeProviderState(observed.state);
      transfer.depositInstructions = redactDepositInstructions(observed.depositInstructions);
      transfer.receipt = observed.receipt;
      transfer.updatedAt = new Date();
      await manager.save(transfer);
      await manager.save(
        manager.create(StateTransitionEntity, {
          transferId: transfer.id,
          fromProviderState: null,
          toProviderState: observed.state,
          fromNormalized: 'submitting',
          toNormalized: transfer.normalizedStatus,
          reason: 'provider_create',
          cause: 'create',
          eventId: null,
          createdAt: transfer.updatedAt,
        }),
      );
      await this.audit(manager, actor, 'transfer_accepted', transfer.id, requestId, {
        providerState: observed.state,
        settlementAuthority: transfer.settlementAuthority,
      });
    });
  }

  private async markFailed(id: string, code: string, actor: Actor, requestId: string): Promise<void> {
    await this.transfers.update({ id, submissionStatus: 'submitting' }, {
      submissionStatus: 'submit_failed',
      normalizedStatus: 'submit_failed',
      failureCode: code,
      updatedAt: new Date(),
    });
    await this.audit(this.transfers.manager, actor, 'transfer_submit_failed', id, requestId, { failureCode: code });
  }

  private async owned(actor: Actor, id: string): Promise<TransferEntity> {
    const transfer = await this.transfers.findOne({ where: { id } });
    if (!transfer) throw new AppError(404, 'transfer_not_found', 'Transfer not found.');
    if (actor.role === 'merchant' && transfer.merchantId !== actor.merchantId) {
      throw new AppError(404, 'transfer_not_found', 'Transfer not found.');
    }
    return transfer;
  }

  private async audit(
    manager: EntityManager,
    actor: Actor,
    action: string,
    resourceId: string,
    requestId: string | null,
    metadata: Record<string, string | number | boolean | null>,
  ): Promise<void> {
    await manager.save(
      manager.create(AuditRecordEntity, {
        actorRole: actor.role,
        actorId: actor.merchantId,
        action,
        resourceType: 'transfer',
        resourceId,
        requestId,
        metadata,
        createdAt: new Date(),
      }),
    );
  }
}

function toCommand(dto: CreateTransferDto, idempotency: string): CreateProviderTransfer {
  return {
    outboundIdempotencyKey: idempotency,
    amount: dto.amount,
    onBehalfOf: dto.onBehalfOf,
    developerFee: dto.developerFee ?? null,
    clientReferenceId: dto.clientReferenceId ?? null,
    source: {
      paymentRail: dto.source.paymentRail,
      currency: dto.source.currency,
      fromAddress: dto.source.fromAddress,
      bridgeWalletId: dto.source.bridgeWalletId,
      senderReturnUrl: dto.source.senderReturnUrl,
    },
    destination: {
      paymentRail: dto.destination.paymentRail,
      currency: dto.destination.currency,
      toAddress: dto.destination.toAddress,
      externalAccountId: dto.destination.externalAccountId,
      reference: dto.destination.reference,
    },
  };
}

function canonicalHash(merchantId: string, dto: CreateTransferDto): string {
  return sha256(
    JSON.stringify({
      merchantId,
      complianceDecisionRef: dto.complianceDecisionRef,
      onBehalfOf: dto.onBehalfOf,
      clientReferenceId: dto.clientReferenceId ?? null,
      amount: dto.amount,
      developerFee: dto.developerFee ?? null,
      sourceRail: dto.source.paymentRail,
      sourceCurrency: dto.source.currency,
      fromAddress: dto.source.fromAddress ?? null,
      bridgeWalletId: dto.source.bridgeWalletId ?? null,
      senderReturnUrl: dto.source.senderReturnUrl ?? null,
      destinationRail: dto.destination.paymentRail,
      destinationCurrency: dto.destination.currency,
      toAddress: dto.destination.toAddress ?? null,
      externalAccountId: dto.destination.externalAccountId ?? null,
      reference: dto.destination.reference ?? null,
    }),
  );
}

function mapProviderError(error: ProviderCallError): AppError {
  if (error.code === 'provider_authentication_failed') {
    return new AppError(502, error.code, 'The Bridge credential was rejected.');
  }
  if (error.code === 'provider_feature_not_enabled' || error.code === 'provider_not_eligible') {
    return new AppError(403, error.code, 'Bridge reported that this account cannot use the request. Eligibility remains unconfirmed.');
  }
  if (error.code === 'compliance_rejected') {
    return new AppError(403, error.code, 'Bridge rejected the transfer during screening. This adapter did not approve compliance.');
  }
  if (error.code === 'provider_unreachable' || error.code === 'resource_state_conflict') {
    return new AppError(503, 'provider_temporarily_unavailable', 'The provider did not complete the request. Retry the same idempotency key.');
  }
  if (error.code === 'idempotency_mismatch') {
    return new AppError(422, error.code, 'The provider rejected the idempotency key for a changed request.');
  }
  if (error.code === 'provider_not_found' || error.code === 'cancel_not_allowed' || error.code === 'fake_provider_cannot_advance') {
    return new AppError(error.status === 404 ? 404 : 409, error.code, 'The provider refused the state change.');
  }
  return new AppError(502, 'provider_rejected', 'The provider rejected the transfer.');
}

function isRetryable(error: ProviderCallError): boolean {
  return error.code === 'provider_unreachable' || error.code === 'resource_state_conflict' || [408, 424, 429, 500, 502, 503, 504].includes(error.status);
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function syntheticCancel(existing: TransferEntity): ProviderTransfer {
  return {
    id: existing.providerTransferId ?? existing.id,
    state: 'canceled',
    amount: existing.amountDecimal,
    currency: existing.amountCurrency,
    developerFee: existing.developerFeeDecimal,
    onBehalfOf: existing.bridgeCustomerId,
    clientReferenceId: existing.clientReferenceId,
    source: {
      paymentRail: existing.sourcePaymentRail,
      currency: existing.sourceCurrency,
      fromAddress: existing.sourceFromAddress,
    },
    destination: {
      paymentRail: existing.destinationPaymentRail,
      currency: existing.destinationCurrency,
      toAddress: existing.destinationToAddress,
      externalAccountId: existing.destinationExternalAccountId,
    },
    depositInstructions: existing.depositInstructions,
    receipt: existing.receipt,
    createdAt: existing.createdAt.toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function toView(transfer: TransferEntity, audience: 'merchant' | 'operator'): TransferView {
  return {
    id: transfer.id,
    merchantId: transfer.merchantId,
    complianceDecisionRef: transfer.complianceDecisionRef,
    clientReferenceId: transfer.clientReferenceId,
    onBehalfOf: transfer.bridgeCustomerId,
    amount: transfer.amountDecimal,
    developerFee: transfer.developerFeeDecimal,
    amountCurrency: transfer.amountCurrency,
    source: {
      paymentRail: transfer.sourcePaymentRail,
      currency: transfer.sourceCurrency,
      fromAddress: transfer.sourceFromAddress,
      bridgeWalletId: transfer.sourceBridgeWalletId,
    },
    destination: {
      paymentRail: transfer.destinationPaymentRail,
      currency: transfer.destinationCurrency,
      toAddress: transfer.destinationToAddress,
      externalAccountId: transfer.destinationExternalAccountId,
      reference: transfer.destinationReference,
    },
    provider: transfer.provider,
    providerTransferId: transfer.providerTransferId,
    providerState: transfer.providerState,
    normalizedStatus: transfer.normalizedStatus,
    submissionStatus: transfer.submissionStatus,
    failureCode: transfer.failureCode,
    depositInstructions: maskInstructions(transfer.depositInstructions, audience),
    depositInstructionStorage: 'redacted_not_encrypted',
    receipt: transfer.receipt,
    documentedMinimum: transfer.documentedMinimum,
    capabilityCode: transfer.capabilityCode,
    complianceVerifier: transfer.complianceVerifier,
    accountEligibility: 'unknown',
    commercialAvailability: 'unconfirmed',
    settlementAuthority: transfer.settlementAuthority,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
  };
}

function maskInstructions(
  value: Record<string, string> | null,
  audience: 'merchant' | 'operator',
): Record<string, string> | null {
  if (!value || audience === 'merchant') return value;
  const masked: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (/beneficiary|bank_address/.test(key)) {
      masked[key] = '[present]';
    } else if (/account|routing|iban|clabe|number/.test(key) && raw.length >= 4) {
      masked[key] = `••••${raw.slice(-4)}`;
    } else {
      masked[key] = raw;
    }
  }
  return masked;
}
