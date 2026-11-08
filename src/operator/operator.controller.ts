import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { APP_CONFIG, Actor, OperatorGuard, operatorCookieMatches, operatorSessionValue, tokenEquals } from '../auth/actor.js';
import { AppConfig } from '../config/env.js';
import { FakeBridgeProvider } from '../bridge/fake-provider.js';
import { AppError } from '../common/errors.js';
import { AuditRecordEntity } from '../persistence/entities.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { TransfersService } from '../transfers/transfers.service.js';
import { renderOperatorPage } from './operator.page.js';

@ApiTags('operator')
@Controller('operator')
export class OperatorController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(ReconciliationService) private readonly reconciliation: ReconciliationService,
    @Inject(FakeBridgeProvider) private readonly fake: FakeBridgeProvider,
  ) {}

  @Get()
  async page(@Req() request: Request, @Res() response: Response) {
    response.type('html').send(renderOperatorPage(await this.model(request, false)));
  }

  @Post('session')
  async session(@Body('apiKey') apiKey: string | undefined, @Res() response: Response) {
    if (!apiKey || !tokenEquals(apiKey, this.config.operatorApiKey)) {
      response.status(401).type('html').send(renderOperatorPage({ ...(await this.model(response.req, true)), authenticated: false }));
      return;
    }
    response.setHeader(
      'Set-Cookie',
      `beekle_operator=${operatorSessionValue(this.config.operatorApiKey)}; HttpOnly; SameSite=Lax; Path=/operator; Max-Age=43200`,
    );
    response.redirect(303, '/operator');
  }

  @Post('logout')
  logout(@Res() response: Response) {
    response.setHeader('Set-Cookie', 'beekle_operator=; HttpOnly; SameSite=Lax; Path=/operator; Max-Age=0');
    response.redirect(303, '/operator');
  }

  @Post('reconciliation/run')
  @UseGuards(OperatorGuard)
  run(@Req() request: Request & { actor: Actor; requestId?: string }) {
    return this.reconciliation.run(request.actor, request.requestId ?? 'operator');
  }

  @Get('audit')
  @UseGuards(OperatorGuard)
  async audit() {
    const rows = await this.dataSource.getRepository(AuditRecordEntity).find({
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      actorRole: row.actorRole,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      requestId: row.requestId,
      metadata: row.metadata,
      createdAt: row.createdAt,
    }));
  }

  @Post('fake-provider/transfers/:id/advance')
  @UseGuards(OperatorGuard)
  async advance(@Param('id') id: string) {
    if (this.config.bridge.provider !== 'fake') {
      throw new AppError(404, 'fake_provider_disabled', 'The fake provider is not active.');
    }
    const transfer = await this.transfers.get({ role: 'operator', merchantId: null }, id);
    if (!transfer.providerTransferId) {
      throw new AppError(409, 'transfer_not_submitted', 'The transfer has no provider id.');
    }
    const observed = await this.fake.advance(transfer.providerTransferId);
    return {
      settlementAuthority: 'local_fake_not_bridge' as const,
      notice: 'The local fake provider moved its own record. No Bridge API was called and no funds moved.',
      providerTransferId: observed.id,
      providerState: observed.state,
      localTransferUnchangedUntilReconciliation: true,
    };
  }

  private async model(request: Request, loginError: boolean) {
    let database: 'up' | 'down' = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }
    const authenticated = operatorCookieMatches(this.config.operatorApiKey, request.header('cookie'));
    const transfers = authenticated ? await this.transfers.list({ role: 'operator', merchantId: null }) : [];
    return {
      provider: this.config.bridge.provider,
      environment: this.config.bridge.environment,
      productionCallsEnabled: this.config.bridge.allowProduction && this.config.bridge.environment === 'production',
      webhookVerification: this.config.webhook.publicKeyPem ? ('configured' as const) : ('blocked' as const),
      database,
      authenticated,
      loginError,
      transfers,
      orchestratedPairCount: 0,
      stellarPairsBlocked: 0,
      explorerPairCount: 0,
    };
  }
}
