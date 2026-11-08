import { loadConfig } from './env.js';

describe('environment', () => {
  const base = {
    NODE_ENV: 'test',
    OPERATOR_API_KEY: 'test-operator-key',
    MERCHANT_API_KEYS: 'demo-merchant:test-merchant-key',
    BRIDGE_PROVIDER: 'fake',
    BRIDGE_ENVIRONMENT: 'sandbox',
    BRIDGE_ALLOW_PRODUCTION: 'false',
    BRIDGE_BASE_URL: 'https://api.sandbox.bridge.xyz/v0',
    DATABASE_NAME: 'beekle_bridge_test',
    DATABASE_PASSWORD: 'test-db-password',
  };

  it('defaults to the sandbox host with production calls disabled', () => {
    const config = loadConfig(base);
    expect(config.bridge.baseUrl).toBe('https://api.sandbox.bridge.xyz/v0');
    expect(config.bridge.allowProduction).toBe(false);
    expect(config.bridge.provider).toBe('fake');
    expect(config.compliance.mode).toBe('unconfigured');
    expect(config.depositInstructionStorage).toBe('redacted');
    expect(config.webhook.publicKeyPem).toBeNull();
    expect(JSON.stringify(config)).not.toContain('BRIDGE_FIXTURE_ORIGIN');
  });

  it('rejects a production host unless environment and the explicit flag agree', () => {
    expect(() =>
      loadConfig({
        ...base,
        BRIDGE_BASE_URL: 'https://api.bridge.xyz/v0',
      }),
    ).toThrow(/production_calls_disabled|environment_host_mismatch|Bridge base URL rejected/);
    expect(() =>
      loadConfig({
        ...base,
        BRIDGE_BASE_URL: 'http://127.0.0.1:9/v0',
        BRIDGE_FIXTURE_ORIGIN: 'http://127.0.0.1:9',
      }),
    ).toThrow(/Bridge base URL rejected/);
  });

  it('requires runtime credentials and rejects placeholders', () => {
    expect(() => loadConfig({ ...base, OPERATOR_API_KEY: '' })).toThrow(/OPERATOR_API_KEY/);
    expect(() => loadConfig({ ...base, OPERATOR_API_KEY: 'replace-me' })).toThrow(/placeholder/);
    expect(() => loadConfig({ ...base, DATABASE_PASSWORD: '' })).toThrow(/DATABASE_PASSWORD/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', BRIDGE_PROVIDER: 'fake' })).toThrow(/fake provider/);
  });

  it('requires a sandbox-prefixed key for the real HTTP provider', () => {
    expect(() =>
      loadConfig({
        ...base,
        BRIDGE_PROVIDER: 'bridge_http',
        BRIDGE_API_KEY: 'live-looking-key',
      }),
    ).toThrow(/sk-test/);
  });

  it('refuses a local demo verifier for the real provider and refuses unimplemented encryption', () => {
    expect(() =>
      loadConfig({
        ...base,
        BRIDGE_PROVIDER: 'bridge_http',
        BRIDGE_API_KEY: 'sk-test-not-a-real-key',
        COMPLIANCE_VERIFIER: 'local_demo',
        LOCAL_DEMO_APPROVAL_REFS: 'dec_local_demo',
      }),
    ).toThrow(/cannot authorize bridge_http/);
    expect(() => loadConfig({ ...base, COMPLIANCE_VERIFIER: 'trusted' })).toThrow(/no implementation/);
    expect(() => loadConfig({ ...base, DEPOSIT_INSTRUCTION_STORAGE: 'encrypted' })).toThrow(/not implemented/);
  });
});
