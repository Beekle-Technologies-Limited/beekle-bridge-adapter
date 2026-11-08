import { toBridgeCreateBody } from './create-body.js';
import { parseProviderTransfer, parseRouteCheck, parseTransferList, safeProviderErrorCode } from './parse-transfer.js';
import { retryDelayMs, shouldRetryProviderCall } from './retry.js';
import { CreateProviderTransfer, ProviderCallError, ProviderRouteCheck, ProviderTransfer } from './types.js';
import { resolveProviderRequestUrl, UrlGuardOptions } from './url-guard.js';

export interface BridgeHttpClientOptions extends UrlGuardOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxAttempts: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_RESPONSE_BYTES = 1_000_000;

export class BridgeHttpClient {
  constructor(private readonly options: BridgeHttpClientOptions) {
    if (!options.apiKey || options.apiKey.length < 8 || options.apiKey.length > 256) {
      throw new ProviderCallError(500, 'provider_api_key_missing');
    }
    resolveProviderRequestUrl(options.baseUrl, '/transfers', options);
  }

  createTransfer(input: CreateProviderTransfer): Promise<ProviderTransfer> {
    return this.request('POST', '/transfers', {
      idempotencyKey: input.outboundIdempotencyKey,
      body: toBridgeCreateBody(input),
      expectedStatus: [201],
      parse: parseProviderTransfer,
    });
  }

  dryRun(input: CreateProviderTransfer): Promise<ProviderRouteCheck> {
    return this.request('POST', '/transfers', {
      idempotencyKey: input.outboundIdempotencyKey,
      body: toBridgeCreateBody({ ...input, dryRun: true }),
      expectedStatus: [201],
      parse: parseRouteCheck,
    });
  }

  getTransfer(providerTransferId: string): Promise<ProviderTransfer> {
    return this.request('GET', `/transfers/${assertProviderId(providerTransferId)}`, {
      expectedStatus: [200],
      parse: parseProviderTransfer,
    });
  }

  listTransfers(query: { limit?: number; state?: string; updatedAfterMs?: number; startingAfter?: string }): Promise<ProviderTransfer[]> {
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100)) {
      throw new ProviderCallError(500, 'invalid_list_query');
    }
    if (query.updatedAfterMs !== undefined && (!Number.isInteger(query.updatedAfterMs) || query.updatedAfterMs < 0)) {
      throw new ProviderCallError(500, 'invalid_list_query');
    }
    if (query.state && !/^[a-z_]{1,64}$/.test(query.state)) throw new ProviderCallError(500, 'invalid_list_query');
    if (query.startingAfter && !/^[A-Za-z0-9_-]{1,64}$/.test(query.startingAfter)) {
      throw new ProviderCallError(500, 'invalid_list_query');
    }
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.state) params.set('state', query.state);
    if (query.updatedAfterMs !== undefined) params.set('updated_after_ms', String(query.updatedAfterMs));
    if (query.startingAfter) params.set('starting_after', query.startingAfter);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.request('GET', `/transfers${suffix}`, {
      expectedStatus: [200],
      parse: parseTransferList,
    });
  }

  async deleteTransfer(providerTransferId: string): Promise<ProviderTransfer | null> {
    return this.request('DELETE', `/transfers/${assertProviderId(providerTransferId)}`, {
      expectedStatus: [200, 204],
      parse: (value, status) => {
        if (status === 204 || value === null || value === '') return null;
        return parseProviderTransfer(value);
      },
    });
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    pathAndQuery: string,
    options: {
      idempotencyKey?: string;
      body?: unknown;
      expectedStatus: number[];
      parse: (value: unknown, status: number) => T;
    },
  ): Promise<T> {
    if (method === 'POST' && !options.idempotencyKey) throw new ProviderCallError(500, 'idempotency_key_required');
    if (method !== 'POST' && options.idempotencyKey) throw new ProviderCallError(500, 'idempotency_key_not_allowed');
    const [path, query] = splitQuery(pathAndQuery);
    const url = resolveProviderRequestUrl(this.options.baseUrl, path, this.options);
    if (query) url.search = query;
    const bodyText = options.body === undefined ? undefined : JSON.stringify(options.body);
    let lastError: ProviderCallError | null = null;

    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt += 1) {
      try {
        const response = await this.send(method, url, bodyText, options.idempotencyKey);
        if (response.status >= 300 && response.status < 400) {
          throw new ProviderCallError(response.status, 'provider_redirect_rejected');
        }
        if (options.expectedStatus.includes(response.status)) {
          return options.parse(response.json, response.status);
        }
        const code = safeProviderErrorCode(response.json) ?? 'provider_rejected';
        const error = new ProviderCallError(response.status, mapStatus(response.status, code));
        const retry = shouldRetryProviderCall({
          method,
          status: response.status,
          errorCode: code,
          networkFailure: false,
        });
        if (!retry || attempt === this.options.maxAttempts) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof ProviderCallError) {
          const retry = shouldRetryProviderCall({
            method,
            status: error.status || null,
            errorCode: error.code === 'resource_state_conflict' ? error.code : error.code,
            networkFailure: error.code === 'provider_unreachable',
          });
          if (!retry || attempt === this.options.maxAttempts) throw error;
          lastError = error;
        } else {
          const network = new ProviderCallError(0, 'provider_unreachable');
          if (attempt === this.options.maxAttempts) throw network;
          lastError = network;
        }
      }
      await (this.options.sleep ?? delay)(retryDelayMs(attempt, this.options.random ?? Math.random));
    }
    throw lastError ?? new ProviderCallError(0, 'provider_unreachable');
  }

  private async send(
    method: string,
    url: URL,
    bodyText: string | undefined,
    idempotencyKey: string | undefined,
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    headers['Api-Key'] = this.options.apiKey;
    if (bodyText !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const fetchImpl = this.options.fetchImpl ?? fetch;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body: bodyText,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch {
      throw new ProviderCallError(0, 'provider_unreachable');
    }
    const text = await readLimited(response);
    if (!text) return { status: response.status, json: null };
    try {
      return { status: response.status, json: JSON.parse(text) as unknown };
    } catch {
      throw new ProviderCallError(502, 'provider_response_invalid');
    }
  }
}

function mapStatus(status: number, code: string): string {
  if (code === 'resource_state_conflict') return code;
  if (code === 'duplicate_record' || code === 'not_truly_idempotent') return 'idempotency_mismatch';
  if (code === 'aml_violation') return 'compliance_rejected';
  if (status === 401 && (code === 'required' || code === 'invalid')) return 'provider_authentication_failed';
  if (status === 401) return 'provider_feature_not_enabled';
  if (status === 403) return 'provider_not_eligible';
  if (status === 404) return 'provider_not_found';
  if (status === 422) return code === 'provider_rejected' ? 'provider_unprocessable' : code;
  if (SAFE_PUBLIC_CODES.has(code)) return code;
  return 'provider_rejected';
}

const SAFE_PUBLIC_CODES = new Set([
  'bad_customer_request',
  'unprocessable_entity',
  'invalid_parameters',
  'unexpected',
  'provider_rejected',
]);

function splitQuery(pathAndQuery: string): [string, string] {
  const index = pathAndQuery.indexOf('?');
  if (index < 0) return [pathAndQuery, ''];
  return [pathAndQuery.slice(0, index), pathAndQuery.slice(index + 1)];
}

async function readLimited(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    received += next.value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ProviderCallError(502, 'provider_response_too_large');
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertProviderId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new ProviderCallError(500, 'invalid_provider_id');
  return encodeURIComponent(value);
}
