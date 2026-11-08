import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Inject } from '@nestjs/common';
import { APP_CONFIG } from '../auth/actor.js';
import { AppConfig } from '../config/env.js';

@Controller()
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Get('health')
  async health() {
    let database: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      provider: this.config.bridge.provider,
      bridgeEnvironment: this.config.bridge.environment,
      productionCallsEnabled: this.config.bridge.allowProduction && this.config.bridge.environment === 'production',
      webhookVerification: this.config.webhook.publicKeyPem ? 'configured' : 'blocked',
      complianceVerifier: this.config.compliance.mode,
      depositInstructionStorage: this.config.depositInstructionStorage,
      settlementAuthority: this.config.bridge.provider === 'fake' ? 'local_fake_not_bridge' : 'bridge_api_unconfirmed',
    };
  }
}
