import { createPublicKey } from 'node:crypto';
import { assertProviderBaseUrl, ProviderUrlError } from '../bridge/url-guard.js';

export interface MerchantCredential {
  merchantId: string;
  apiKey: string;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  operatorApiKey: string;
  merchants: MerchantCredential[];
  bridge: {
    provider: 'fake' | 'bridge_http';
    environment: 'sandbox' | 'production';
    allowProduction: boolean;
    baseUrl: string;
    apiKey: string | null;
    timeoutMs: number;
    maxAttempts: number;
  };
  webhook: {
    publicKeyPem: string | null;
    maxAgeMs: number;
    futureSkewMs: number;
  };
  compliance: {
    mode: 'unconfigured' | 'local_demo';
    localDemoApprovalRefs: string[];
  };
  depositInstructionStorage: 'redacted';
  reconcileIntervalMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const provider = env.BRIDGE_PROVIDER ?? 'fake';
  if (provider !== 'fake' && provider !== 'bridge_http') {
    throw new Error('BRIDGE_PROVIDER must be fake or bridge_http');
  }
  const environment = env.BRIDGE_ENVIRONMENT ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production') {
    throw new Error('BRIDGE_ENVIRONMENT must be sandbox or production');
  }
  const allowProduction = env.BRIDGE_ALLOW_PRODUCTION === 'true';
  const baseUrl = env.BRIDGE_BASE_URL ?? 'https://api.sandbox.bridge.xyz/v0';
  try {
    assertProviderBaseUrl(baseUrl, { allowProduction, environment });
  } catch (error) {
    if (error instanceof ProviderUrlError) {
      throw new Error(`Bridge base URL rejected: ${error.code}`);
    }
    throw error;
  }
  const apiKey = blankToNull(env.BRIDGE_API_KEY);
  if (provider === 'bridge_http' && !apiKey) {
    throw new Error('BRIDGE_API_KEY is required when BRIDGE_PROVIDER=bridge_http');
  }
  if (provider === 'bridge_http' && environment === 'sandbox' && apiKey && !apiKey.startsWith('sk-test')) {
    throw new Error('Sandbox Bridge keys are documented to start with sk-test. Refusing a non-sandbox key prefix.');
  }

  const operatorApiKey = env.OPERATOR_API_KEY ?? '';
  const merchants = parseMerchants(env.MERCHANT_API_KEYS ?? '');
  if (!operatorApiKey || merchants.length === 0) {
    throw new Error('OPERATOR_API_KEY and MERCHANT_API_KEYS are required');
  }
  if (isPlaceholderSecret(operatorApiKey) || merchants.some((merchant) => isPlaceholderSecret(merchant.apiKey))) {
    throw new Error('Replace placeholder operator and merchant credentials before starting');
  }
  const databasePassword = env.DATABASE_PASSWORD ?? '';
  if (!databasePassword || isPlaceholderSecret(databasePassword)) {
    throw new Error('DATABASE_PASSWORD is required and must not be a placeholder');
  }
  if (nodeEnv === 'production' && provider === 'fake') {
    throw new Error('Refusing the local fake provider when NODE_ENV=production');
  }

  const depositInstructionStorage = env.DEPOSIT_INSTRUCTION_STORAGE ?? 'redacted';
  if (depositInstructionStorage === 'encrypted') {
    throw new Error(
      'DEPOSIT_INSTRUCTION_STORAGE=encrypted is not implemented. Raw bank details are not persisted.',
    );
  }
  if (depositInstructionStorage !== 'redacted') {
    throw new Error('DEPOSIT_INSTRUCTION_STORAGE must be redacted');
  }
  const compliance = resolveCompliance(env, provider, nodeEnv);

  return {
    nodeEnv,
    port: parseIntInRange(env.PORT, 43117, 1, 65535),
    database: {
      host: env.DATABASE_HOST ?? '127.0.0.1',
      port: parseIntInRange(env.DATABASE_PORT, 3306, 1, 65535),
      user: env.DATABASE_USER ?? 'beekle',
      password: databasePassword,
      name: env.DATABASE_NAME ?? (nodeEnv === 'test' ? 'beekle_bridge_test' : 'beekle_bridge'),
    },
    operatorApiKey,
    merchants,
    bridge: {
      provider,
      environment,
      allowProduction,
      baseUrl,
      apiKey,
      timeoutMs: parseIntInRange(env.BRIDGE_HTTP_TIMEOUT_MS, 15_000, 1_000, 60_000),
      maxAttempts: parseIntInRange(env.BRIDGE_HTTP_MAX_ATTEMPTS, 3, 1, 5),
    },
    webhook: {
      publicKeyPem: readWebhookKey(env.BRIDGE_WEBHOOK_PUBLIC_KEY),
      maxAgeMs: parseIntInRange(env.BRIDGE_WEBHOOK_MAX_AGE_MS, 600_000, 1_000, 600_000),
      futureSkewMs: parseIntInRange(env.BRIDGE_WEBHOOK_FUTURE_SKEW_MS, 300_000, 0, 300_000),
    },
    compliance,
    depositInstructionStorage,
    reconcileIntervalMs: parseReconcileInterval(env.RECONCILE_INTERVAL_MS),
  };
}

function resolveCompliance(
  env: NodeJS.ProcessEnv,
  provider: 'fake' | 'bridge_http',
  nodeEnv: AppConfig['nodeEnv'],
): AppConfig['compliance'] {
  const requested = env.COMPLIANCE_VERIFIER ?? (provider === 'fake' && nodeEnv === 'development' ? 'local_demo' : 'unconfigured');
  if (requested === 'trusted') {
    throw new Error(
      'COMPLIANCE_VERIFIER=trusted has no implementation in this build. Real provider creates stay blocked.',
    );
  }
  if (requested !== 'local_demo' && requested !== 'unconfigured') {
    throw new Error('COMPLIANCE_VERIFIER must be local_demo or unconfigured');
  }
  if (requested === 'local_demo' && provider !== 'fake') {
    throw new Error('The local demo compliance verifier cannot authorize bridge_http creates.');
  }
  if (requested === 'local_demo' && nodeEnv === 'production') {
    throw new Error('The local demo compliance verifier is refused when NODE_ENV=production');
  }
  const fallbackRefs = requested === 'local_demo' && nodeEnv === 'development' ? 'dec_local_demo' : '';
  const localDemoApprovalRefs = (env.LOCAL_DEMO_APPROVAL_REFS ?? fallbackRefs)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (requested === 'local_demo' && localDemoApprovalRefs.length === 0) {
    throw new Error('LOCAL_DEMO_APPROVAL_REFS must list explicit demo decision refs.');
  }
  for (const ref of localDemoApprovalRefs) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(ref)) throw new Error('A local demo approval ref is not a safe token');
  }
  return { mode: requested, localDemoApprovalRefs };
}

function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'replace-me' || normalized === 'changeme' || normalized === 'change-me' || normalized === 'password' || normalized === 'secret';
}

function parseNodeEnv(value: string | undefined): AppConfig['nodeEnv'] {
  if (value === 'production' || value === 'test') return value;
  return 'development';
}

function parseMerchants(raw: string): MerchantCredential[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((entry) => {
    const separator = entry.indexOf(':');
    if (separator <= 0) throw new Error('MERCHANT_API_KEYS entries must look like merchantId:key');
    const merchantId = entry.slice(0, separator).trim();
    const apiKey = entry.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(merchantId) || apiKey.length < 8 || apiKey.length > 256) {
      throw new Error('A merchant credential is missing or too short');
    }
    return { merchantId, apiKey };
  });
}

function readWebhookKey(raw: string | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
  try {
    createPublicKey(pem);
  } catch {
    throw new Error('BRIDGE_WEBHOOK_PUBLIC_KEY is not a usable PEM public key');
  }
  return pem;
}

function parseReconcileInterval(raw: string | undefined): number {
  const parsed = parseIntInRange(raw, 0, 0, 3_600_000);
  if (parsed === 0) return 0;
  return Math.max(parsed, 5_000);
}

function parseIntInRange(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error('Expected an integer environment value');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error('An environment integer is outside its allowed range');
  }
  return value;
}

function blankToNull(value: string | undefined): string | null {
  if (!value || !value.trim()) return null;
  return value.trim();
}
