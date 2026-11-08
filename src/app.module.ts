import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_CONFIG } from './auth/actor.js';
import { MerchantGuard, OperatorGuard } from './auth/actor.js';
import { FakeBridgeProvider } from './bridge/fake-provider.js';
import { BRIDGE_PROVIDER, BridgeHttpProvider } from './bridge/provider.js';
import { CapabilitiesController } from './capabilities/capabilities.controller.js';
import { createComplianceVerifier, COMPLIANCE_VERIFIER } from './compliance/approval-verifier.js';
import { AppConfig, loadConfig } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { OperatorController } from './operator/operator.controller.js';
import {
  AuditRecordEntity,
  FakeProviderTransferEntity,
  ReconciliationRunEntity,
  StateTransitionEntity,
  TransferEntity,
  WebhookEventEntity,
} from './persistence/entities.js';
import { AddComplianceVerifier1731000000001 } from './persistence/add-compliance-verifier.migration.js';
import { InitialSchema1731000000000 } from './persistence/initial-migration.js';
import { ReconciliationService } from './reconciliation/reconciliation.service.js';
import { TransfersController } from './transfers/transfers.controller.js';
import { TransfersService } from './transfers/transfers.service.js';
import { WebhooksController } from './webhooks/webhooks.controller.js';
import { WebhooksService } from './webhooks/webhooks.service.js';

const ENTITIES = [
  TransferEntity,
  WebhookEventEntity,
  StateTransitionEntity,
  AuditRecordEntity,
  ReconciliationRunEntity,
  FakeProviderTransferEntity,
];

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        type: 'mysql' as const,
        host: config.database.host,
        port: config.database.port,
        username: config.database.user,
        password: config.database.password,
        database: config.database.name,
        entities: ENTITIES,
        migrations: [InitialSchema1731000000000, AddComplianceVerifier1731000000001],
        migrationsRun: true,
        synchronize: false,
        timezone: 'Z',
        charset: 'utf8mb4',
      }),
    }),
    TypeOrmModule.forFeature(ENTITIES),
  ],
  controllers: [
    HealthController,
    CapabilitiesController,
    TransfersController,
    WebhooksController,
    OperatorController,
  ],
  providers: [
    MerchantGuard,
    OperatorGuard,
    TransfersService,
    WebhooksService,
    ReconciliationService,
    FakeBridgeProvider,
    BridgeHttpProvider,
    {
      provide: COMPLIANCE_VERIFIER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createComplianceVerifier(config.compliance),
    },
    {
      provide: BRIDGE_PROVIDER,
      inject: [APP_CONFIG, FakeBridgeProvider, BridgeHttpProvider],
      useFactory: (config: AppConfig, fake: FakeBridgeProvider, http: BridgeHttpProvider) =>
        config.bridge.provider === 'fake' ? fake : http,
    },
  ],
})
export class AppModule {}
