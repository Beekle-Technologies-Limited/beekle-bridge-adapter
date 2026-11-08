import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1731000000000 implements MigrationInterface {
  name = 'InitialSchema1731000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transfers (
        id CHAR(36) NOT NULL,
        merchant_id VARCHAR(64) NOT NULL,
        compliance_decision_ref VARCHAR(128) NOT NULL,
        client_reference_id VARCHAR(256) NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        request_hash CHAR(64) NOT NULL,
        outbound_idempotency_key CHAR(36) NOT NULL,
        bridge_customer_id VARCHAR(64) NOT NULL,
        amount_decimal VARCHAR(64) NOT NULL,
        developer_fee_decimal VARCHAR(64) NULL,
        amount_currency VARCHAR(16) NOT NULL,
        source_payment_rail VARCHAR(64) NOT NULL,
        source_currency VARCHAR(16) NOT NULL,
        source_from_address VARCHAR(256) NULL,
        source_bridge_wallet_id VARCHAR(64) NULL,
        source_return_url VARCHAR(512) NULL,
        destination_payment_rail VARCHAR(64) NOT NULL,
        destination_currency VARCHAR(16) NOT NULL,
        destination_to_address VARCHAR(256) NULL,
        destination_external_account_id VARCHAR(64) NULL,
        destination_reference VARCHAR(256) NULL,
        provider VARCHAR(32) NOT NULL,
        provider_transfer_id VARCHAR(64) NULL,
        provider_state VARCHAR(64) NULL,
        normalized_status VARCHAR(64) NOT NULL,
        submission_status VARCHAR(32) NOT NULL,
        failure_code VARCHAR(64) NULL,
        last_event_sequence BIGINT NULL,
        last_event_created_at DATETIME(3) NULL,
        deposit_instructions JSON NULL,
        receipt JSON NULL,
        documented_minimum VARCHAR(64) NULL,
        capability_code VARCHAR(128) NOT NULL,
        account_eligibility VARCHAR(32) NOT NULL,
        commercial_availability VARCHAR(32) NOT NULL,
        settlement_authority VARCHAR(64) NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        last_reconciled_at DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_transfers_merchant_idempotency (merchant_id, idempotency_key),
        UNIQUE KEY uq_transfers_merchant_reference (merchant_id, client_reference_id),
        UNIQUE KEY uq_transfers_outbound_key (outbound_idempotency_key),
        UNIQUE KEY uq_transfers_provider_id (provider_transfer_id),
        KEY ix_transfers_status_updated (normalized_status, updated_at),
        CONSTRAINT chk_transfers_amount CHECK (amount_decimal REGEXP '^(0|[1-9][0-9]{0,19})([.][0-9]{1,18})?$')
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE webhook_events (
        id CHAR(36) NOT NULL,
        event_id VARCHAR(128) NOT NULL,
        event_category VARCHAR(64) NOT NULL,
        event_type VARCHAR(128) NOT NULL,
        event_object_id VARCHAR(64) NULL,
        event_sequence BIGINT NULL,
        event_created_at DATETIME(3) NULL,
        signature_timestamp_ms BIGINT NOT NULL,
        payload_sha256 CHAR(64) NOT NULL,
        processing_result VARCHAR(64) NOT NULL,
        transfer_id CHAR(36) NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_webhook_events_event_id (event_id),
        KEY ix_webhook_events_object (event_object_id),
        CONSTRAINT fk_webhook_events_transfer FOREIGN KEY (transfer_id) REFERENCES transfers (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE state_transitions (
        id BIGINT NOT NULL AUTO_INCREMENT,
        transfer_id CHAR(36) NOT NULL,
        from_provider_state VARCHAR(64) NULL,
        to_provider_state VARCHAR(64) NOT NULL,
        from_normalized VARCHAR(64) NULL,
        to_normalized VARCHAR(64) NOT NULL,
        reason VARCHAR(64) NOT NULL,
        cause VARCHAR(32) NOT NULL,
        event_id VARCHAR(128) NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY ix_state_transitions_transfer (transfer_id, created_at),
        CONSTRAINT fk_state_transitions_transfer FOREIGN KEY (transfer_id) REFERENCES transfers (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE audit_records (
        id BIGINT NOT NULL AUTO_INCREMENT,
        actor_role VARCHAR(32) NOT NULL,
        actor_id VARCHAR(64) NULL,
        action VARCHAR(64) NOT NULL,
        resource_type VARCHAR(64) NOT NULL,
        resource_id VARCHAR(64) NULL,
        request_id VARCHAR(64) NULL,
        metadata JSON NULL,
        created_at DATETIME(3) NOT NULL,
        PRIMARY KEY (id),
        KEY ix_audit_records_resource (resource_type, resource_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE reconciliation_runs (
        id CHAR(36) NOT NULL,
        started_at DATETIME(3) NOT NULL,
        finished_at DATETIME(3) NULL,
        transfers_checked INT NOT NULL,
        updates_applied INT NOT NULL,
        unchanged INT NOT NULL,
        errors_count INT NOT NULL,
        status VARCHAR(32) NOT NULL,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await queryRunner.query(`
      CREATE TABLE fake_provider_transfers (
        provider_transfer_id VARCHAR(64) NOT NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        state VARCHAR(64) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME(3) NOT NULL,
        updated_at DATETIME(3) NOT NULL,
        label VARCHAR(64) NOT NULL DEFAULT 'LOCAL_FAKE_NOT_BRIDGE',
        PRIMARY KEY (provider_transfer_id),
        UNIQUE KEY uq_fake_provider_idempotency (idempotency_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS fake_provider_transfers');
    await queryRunner.query('DROP TABLE IF EXISTS reconciliation_runs');
    await queryRunner.query('DROP TABLE IF EXISTS audit_records');
    await queryRunner.query('DROP TABLE IF EXISTS state_transitions');
    await queryRunner.query('DROP TABLE IF EXISTS webhook_events');
    await queryRunner.query('DROP TABLE IF EXISTS transfers');
  }
}
