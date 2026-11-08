import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'transfers' })
export class TransferEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'merchant_id', type: 'varchar', length: 64 })
  merchantId!: string;

  @Column({ name: 'compliance_decision_ref', type: 'varchar', length: 128 })
  complianceDecisionRef!: string;

  @Column({ name: 'compliance_verifier', type: 'varchar', length: 64, default: 'not_recorded' })
  complianceVerifier!: string;

  @Column({ name: 'client_reference_id', type: 'varchar', length: 256, nullable: true })
  clientReferenceId!: string | null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'char', length: 64 })
  requestHash!: string;

  @Column({ name: 'outbound_idempotency_key', type: 'char', length: 36 })
  outboundIdempotencyKey!: string;

  @Column({ name: 'bridge_customer_id', type: 'varchar', length: 64 })
  bridgeCustomerId!: string;

  @Column({ name: 'amount_decimal', type: 'varchar', length: 64 })
  amountDecimal!: string;

  @Column({ name: 'developer_fee_decimal', type: 'varchar', length: 64, nullable: true })
  developerFeeDecimal!: string | null;

  @Column({ name: 'amount_currency', type: 'varchar', length: 16 })
  amountCurrency!: string;

  @Column({ name: 'source_payment_rail', type: 'varchar', length: 64 })
  sourcePaymentRail!: string;

  @Column({ name: 'source_currency', type: 'varchar', length: 16 })
  sourceCurrency!: string;

  @Column({ name: 'source_from_address', type: 'varchar', length: 256, nullable: true })
  sourceFromAddress!: string | null;

  @Column({ name: 'source_bridge_wallet_id', type: 'varchar', length: 64, nullable: true })
  sourceBridgeWalletId!: string | null;

  @Column({ name: 'source_return_url', type: 'varchar', length: 512, nullable: true })
  sourceReturnUrl!: string | null;

  @Column({ name: 'destination_payment_rail', type: 'varchar', length: 64 })
  destinationPaymentRail!: string;

  @Column({ name: 'destination_currency', type: 'varchar', length: 16 })
  destinationCurrency!: string;

  @Column({ name: 'destination_to_address', type: 'varchar', length: 256, nullable: true })
  destinationToAddress!: string | null;

  @Column({ name: 'destination_external_account_id', type: 'varchar', length: 64, nullable: true })
  destinationExternalAccountId!: string | null;

  @Column({ name: 'destination_reference', type: 'varchar', length: 256, nullable: true })
  destinationReference!: string | null;

  @Column({ type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'provider_transfer_id', type: 'varchar', length: 64, nullable: true })
  providerTransferId!: string | null;

  @Column({ name: 'provider_state', type: 'varchar', length: 64, nullable: true })
  providerState!: string | null;

  @Column({ name: 'normalized_status', type: 'varchar', length: 64 })
  normalizedStatus!: string;

  @Column({ name: 'submission_status', type: 'varchar', length: 32 })
  submissionStatus!: string;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode!: string | null;

  @Column({ name: 'last_event_sequence', type: 'bigint', nullable: true })
  lastEventSequence!: string | null;

  @Column({ name: 'last_event_created_at', type: 'datetime', precision: 3, nullable: true })
  lastEventCreatedAt!: Date | null;

  @Column({ name: 'deposit_instructions', type: 'json', nullable: true })
  depositInstructions!: Record<string, string> | null;

  @Column({ type: 'json', nullable: true })
  receipt!: Record<string, string> | null;

  @Column({ name: 'documented_minimum', type: 'varchar', length: 64, nullable: true })
  documentedMinimum!: string | null;

  @Column({ name: 'capability_code', type: 'varchar', length: 128 })
  capabilityCode!: string;

  @Column({ name: 'account_eligibility', type: 'varchar', length: 32 })
  accountEligibility!: string;

  @Column({ name: 'commercial_availability', type: 'varchar', length: 32 })
  commercialAvailability!: string;

  @Column({ name: 'settlement_authority', type: 'varchar', length: 64 })
  settlementAuthority!: string;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;

  @Column({ name: 'last_reconciled_at', type: 'datetime', precision: 3, nullable: true })
  lastReconciledAt!: Date | null;
}

@Entity({ name: 'webhook_events' })
export class WebhookEventEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 128 })
  eventId!: string;

  @Column({ name: 'event_category', type: 'varchar', length: 64 })
  eventCategory!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 128 })
  eventType!: string;

  @Column({ name: 'event_object_id', type: 'varchar', length: 64, nullable: true })
  eventObjectId!: string | null;

  @Column({ name: 'event_sequence', type: 'bigint', nullable: true })
  eventSequence!: string | null;

  @Column({ name: 'event_created_at', type: 'datetime', precision: 3, nullable: true })
  eventCreatedAt!: Date | null;

  @Column({ name: 'signature_timestamp_ms', type: 'bigint' })
  signatureTimestampMs!: string;

  @Column({ name: 'payload_sha256', type: 'char', length: 64 })
  payloadSha256!: string;

  @Column({ name: 'processing_result', type: 'varchar', length: 64 })
  processingResult!: string;

  @Column({ name: 'transfer_id', type: 'char', length: 36, nullable: true })
  transferId!: string | null;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'state_transitions' })
export class StateTransitionEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'transfer_id', type: 'char', length: 36 })
  transferId!: string;

  @Column({ name: 'from_provider_state', type: 'varchar', length: 64, nullable: true })
  fromProviderState!: string | null;

  @Column({ name: 'to_provider_state', type: 'varchar', length: 64 })
  toProviderState!: string;

  @Column({ name: 'from_normalized', type: 'varchar', length: 64, nullable: true })
  fromNormalized!: string | null;

  @Column({ name: 'to_normalized', type: 'varchar', length: 64 })
  toNormalized!: string;

  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ type: 'varchar', length: 32 })
  cause!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 128, nullable: true })
  eventId!: string | null;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'audit_records' })
export class AuditRecordEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 32 })
  actorRole!: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 64, nullable: true })
  actorId!: string | null;

  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 64 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 64, nullable: true })
  resourceId!: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 64, nullable: true })
  requestId!: string | null;

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, string | number | boolean | null> | null;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;
}

@Entity({ name: 'reconciliation_runs' })
export class ReconciliationRunEntity {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'started_at', type: 'datetime', precision: 3 })
  startedAt!: Date;

  @Column({ name: 'finished_at', type: 'datetime', precision: 3, nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'transfers_checked', type: 'int' })
  transfersChecked!: number;

  @Column({ name: 'updates_applied', type: 'int' })
  updatesApplied!: number;

  @Column({ type: 'int' })
  unchanged!: number;

  @Column({ name: 'errors_count', type: 'int' })
  errorsCount!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: string;
}

@Entity({ name: 'fake_provider_transfers' })
export class FakeProviderTransferEntity {
  @PrimaryColumn({ name: 'provider_transfer_id', type: 'varchar', length: 64 })
  providerTransferId!: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 200 })
  idempotencyKey!: string;

  @Column({ type: 'varchar', length: 64 })
  state!: string;

  @Column({ type: 'json' })
  payload!: Record<string, unknown>;

  @Column({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
