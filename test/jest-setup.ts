import 'reflect-metadata';

process.env.NODE_ENV ??= 'test';
process.env.OPERATOR_API_KEY ??= 'test-operator-key';
process.env.MERCHANT_API_KEYS ??= 'demo-merchant:test-merchant-key';
process.env.BRIDGE_PROVIDER ??= 'fake';
process.env.BRIDGE_ENVIRONMENT ??= 'sandbox';
process.env.BRIDGE_ALLOW_PRODUCTION ??= 'false';
process.env.BRIDGE_BASE_URL ??= 'https://api.sandbox.bridge.xyz/v0';
process.env.DATABASE_HOST ??= '127.0.0.1';
process.env.DATABASE_PORT ??= '3306';
process.env.DATABASE_USER ??= 'beekle';
process.env.DATABASE_PASSWORD ??= 'test-db-password';
process.env.DATABASE_NAME ??= 'beekle_bridge_test';
process.env.RECONCILE_INTERVAL_MS ??= '0';
process.env.COMPLIANCE_VERIFIER ??= 'local_demo';
process.env.LOCAL_DEMO_APPROVAL_REFS ??= 'dec_local_demo';
process.env.DEPOSIT_INSTRUCTION_STORAGE ??= 'redacted';
