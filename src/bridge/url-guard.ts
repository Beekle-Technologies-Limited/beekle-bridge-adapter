export class ProviderUrlError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface UrlGuardOptions {
  allowProduction: boolean;
  environment: 'sandbox' | 'production';
  /**
   * In-process fixture origin for unit tests. The Nest process never sets this.
   * Only 127.0.0.1 is accepted, so it cannot be pointed at a link-local address.
   */
  fixtureOrigin?: string;
}

const SANDBOX_HOST = 'api.sandbox.bridge.xyz';
const PRODUCTION_HOST = 'api.bridge.xyz';

export function assertProviderBaseUrl(raw: string, options: UrlGuardOptions): URL {
  const parsed = parseHttpsOrFixture(raw, options);
  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/v0')) {
    throw new ProviderUrlError('provider_url_path_rejected');
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new ProviderUrlError('provider_url_rejected');
  }
  return parsed;
}

export function resolveProviderRequestUrl(baseRaw: string, path: string, options: UrlGuardOptions): URL {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || path.includes('\\')) {
    throw new ProviderUrlError('provider_path_rejected');
  }
  const base = assertProviderBaseUrl(baseRaw, options);
  const basePath = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${basePath}${path}`, `${base.protocol}//${base.host}`);
  if (url.hostname !== base.hostname || url.port !== base.port || url.protocol !== base.protocol) {
    throw new ProviderUrlError('provider_url_rejected');
  }
  return url;
}

function parseHttpsOrFixture(raw: string, options: UrlGuardOptions): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ProviderUrlError('provider_url_rejected');
  }
  if (parsed.username || parsed.password) throw new ProviderUrlError('provider_url_rejected');

  if (options.fixtureOrigin) {
    let fixture: URL;
    try {
      fixture = new URL(options.fixtureOrigin);
    } catch {
      throw new ProviderUrlError('provider_url_rejected');
    }
    if (fixture.hostname !== '127.0.0.1') throw new ProviderUrlError('fixture_origin_rejected');
    if (
      parsed.protocol !== fixture.protocol ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.port !== fixture.port
    ) {
      throw new ProviderUrlError('provider_url_rejected');
    }
    return parsed;
  }

  if (parsed.protocol !== 'https:') throw new ProviderUrlError('provider_url_not_https');
  if (parsed.port && parsed.port !== '443') throw new ProviderUrlError('provider_url_port_rejected');
  const host = parsed.hostname.toLowerCase();
  if (host !== SANDBOX_HOST && host !== PRODUCTION_HOST) {
    throw new ProviderUrlError('provider_host_not_allowlisted');
  }
  if (host === PRODUCTION_HOST && !options.allowProduction) {
    throw new ProviderUrlError('production_calls_disabled');
  }
  if (options.environment === 'sandbox' && host !== SANDBOX_HOST) {
    throw new ProviderUrlError('environment_host_mismatch');
  }
  if (options.environment === 'production' && host !== PRODUCTION_HOST) {
    throw new ProviderUrlError('environment_host_mismatch');
  }
  if (options.environment === 'production' && !options.allowProduction) {
    throw new ProviderUrlError('production_calls_disabled');
  }
  return parsed;
}
