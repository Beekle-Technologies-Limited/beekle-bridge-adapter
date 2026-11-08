import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../config/env.js';
import { APP_CONFIG } from '../auth/actor.js';
import { BridgeHttpClient } from './http-client.js';
import { CreateProviderTransfer, ProviderTransfer } from './types.js';

export const BRIDGE_PROVIDER = Symbol('BRIDGE_PROVIDER');

export interface BridgeTransferProvider {
  readonly mode: 'fake' | 'bridge_http';
  readonly settlementAuthority: 'local_fake_not_bridge' | 'bridge_api_unconfirmed';
  createTransfer(input: CreateProviderTransfer): Promise<ProviderTransfer>;
  getTransfer(providerTransferId: string): Promise<ProviderTransfer>;
  deleteTransfer(providerTransferId: string): Promise<ProviderTransfer | null>;
}

@Injectable()
export class BridgeHttpProvider implements BridgeTransferProvider {
  readonly mode = 'bridge_http' as const;
  readonly settlementAuthority = 'bridge_api_unconfirmed' as const;
  private client: BridgeHttpClient | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  createTransfer(input: CreateProviderTransfer): Promise<ProviderTransfer> {
    return this.getClient().createTransfer(input);
  }

  getTransfer(providerTransferId: string): Promise<ProviderTransfer> {
    return this.getClient().getTransfer(providerTransferId);
  }

  deleteTransfer(providerTransferId: string): Promise<ProviderTransfer | null> {
    return this.getClient().deleteTransfer(providerTransferId);
  }

  dryRun(input: CreateProviderTransfer) {
    return this.getClient().dryRun(input);
  }

  private getClient(): BridgeHttpClient {
    if (!this.config.bridge.apiKey) {
      throw new Error('BRIDGE_API_KEY is required when BRIDGE_PROVIDER=bridge_http');
    }
    if (!this.client) {
      this.client = new BridgeHttpClient({
        baseUrl: this.config.bridge.baseUrl,
        apiKey: this.config.bridge.apiKey,
        timeoutMs: this.config.bridge.timeoutMs,
        maxAttempts: this.config.bridge.maxAttempts,
        allowProduction: this.config.bridge.allowProduction,
        environment: this.config.bridge.environment,
      });
    }
    return this.client;
  }
}
