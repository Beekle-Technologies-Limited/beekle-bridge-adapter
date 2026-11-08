import { assertProviderBaseUrl, ProviderUrlError, resolveProviderRequestUrl } from './url-guard.js';

const sandbox = {
  allowProduction: false,
  environment: 'sandbox' as const,
};

describe('provider URL guard', () => {
  it('allows the documented sandbox and production hosts only under explicit flags', () => {
    expect(assertProviderBaseUrl('https://api.sandbox.bridge.xyz/v0', sandbox).hostname).toBe(
      'api.sandbox.bridge.xyz',
    );
    expect(
      assertProviderBaseUrl('https://api.bridge.xyz/v0', {
        allowProduction: true,
        environment: 'production',
      }).hostname,
    ).toBe('api.bridge.xyz');
  });

  it('rejects production, private hosts, plaintext, credentials, and odd paths', () => {
    expect(() => assertProviderBaseUrl('https://api.bridge.xyz/v0', sandbox)).toThrow(ProviderUrlError);
    expect(() => assertProviderBaseUrl('http://api.sandbox.bridge.xyz/v0', sandbox)).toThrow(ProviderUrlError);
    expect(() => assertProviderBaseUrl('https://127.0.0.1/v0', sandbox)).toThrow(ProviderUrlError);
    expect(() => assertProviderBaseUrl('https://169.254.169.254/v0', sandbox)).toThrow(ProviderUrlError);
    expect(() => assertProviderBaseUrl('https://user:pass@api.sandbox.bridge.xyz/v0', sandbox)).toThrow(
      ProviderUrlError,
    );
    expect(() => assertProviderBaseUrl('https://api.sandbox.bridge.xyz.evil.example/v0', sandbox)).toThrow(
      ProviderUrlError,
    );
    expect(() =>
      resolveProviderRequestUrl('https://api.sandbox.bridge.xyz/v0', '//evil.example', sandbox),
    ).toThrow(ProviderUrlError);
    expect(() =>
      resolveProviderRequestUrl('https://api.sandbox.bridge.xyz/v0', '/../../etc', sandbox),
    ).toThrow(ProviderUrlError);
  });

  it('allows a loopback fixture origin only when the caller passes it in process', () => {
    const options = { ...sandbox, fixtureOrigin: 'http://127.0.0.1:9' };
    expect(resolveProviderRequestUrl('http://127.0.0.1:9/v0', '/transfers', options).href).toBe(
      'http://127.0.0.1:9/v0/transfers',
    );
    expect(() =>
      resolveProviderRequestUrl('http://169.254.169.254:9/v0', '/transfers', {
        ...sandbox,
        fixtureOrigin: 'http://169.254.169.254:9',
      }),
    ).toThrow(ProviderUrlError);
  });
});
