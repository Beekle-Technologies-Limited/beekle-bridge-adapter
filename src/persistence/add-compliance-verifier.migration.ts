import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddComplianceVerifier1731000000001 implements MigrationInterface {
  name = 'AddComplianceVerifier1731000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns: Array<{ COLUMN_NAME?: string }> = await queryRunner.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'transfers' AND COLUMN_NAME = 'compliance_verifier'`,
    );
    if (columns.length > 0) return;
    await queryRunner.query(
      `ALTER TABLE transfers ADD COLUMN compliance_verifier VARCHAR(64) NOT NULL DEFAULT 'not_recorded'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE transfers DROP COLUMN compliance_verifier');
  }
}
