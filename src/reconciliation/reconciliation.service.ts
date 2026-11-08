import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { APP_CONFIG, Actor } from '../auth/actor.js';
import { AppConfig } from '../config/env.js';
import { BRIDGE_PROVIDER, BridgeTransferProvider } from '../bridge/provider.js';
import { ProviderCallError } from '../bridge/types.js';
import { AppError } from '../common/errors.js';
import { randomId } from '../common/ids.js';
import { ReconciliationRunEntity } from '../persistence/entities.js';
import { TransfersService } from '../transfers/transfers.service.js';

@Injectable()
export class ReconciliationService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(BRIDGE_PROVIDER) private readonly provider: BridgeTransferProvider,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @InjectRepository(ReconciliationRunEntity) private readonly runs: Repository<ReconciliationRunEntity>,
  ) {}

  onModuleInit(): void {
    if (this.config.reconcileIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.run({ role: 'operator', merchantId: null }, 'interval').catch(() => undefined);
    }, this.config.reconcileIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(actor: Actor, requestId: string): Promise<ReconciliationRunEntity> {
    if (this.running) {
      throw new AppError(409, 'reconciliation_in_progress', 'A reconciliation run is already in progress.');
    }
    this.running = true;
    const run = this.runs.create({
      id: randomId(),
      startedAt: new Date(),
      finishedAt: null,
      transfersChecked: 0,
      updatesApplied: 0,
      unchanged: 0,
      errorsCount: 0,
      status: 'running',
    });
    await this.runs.insert(run);
    try {
      const rows = await this.transfers.candidatesForReconciliation(new Date());
      for (const row of rows) {
        if (!row.providerTransferId) continue;
        run.transfersChecked += 1;
        try {
          const observed = await this.provider.getTransfer(row.providerTransferId);
          const parsed = observed.updatedAt ? Date.parse(observed.updatedAt) : Number.NaN;
          const applied = await this.runs.manager.transaction((manager) =>
            this.transfers.applyObservation(manager, {
              providerTransferId: row.providerTransferId as string,
              observed,
              cause: 'reconciliation',
              eventSequence: null,
              eventCreatedAtMs: Number.isFinite(parsed) ? parsed : null,
              eventId: null,
              actor,
              requestId,
            }),
          );
          if (applied.result === 'applied') run.updatesApplied += 1;
          else run.unchanged += 1;
        } catch (error) {
          run.errorsCount += 1;
          if (error instanceof ProviderCallError && error.code === 'provider_unreachable') break;
        }
      }
      run.status = 'finished';
      run.finishedAt = new Date();
      await this.runs.save(run);
      return run;
    } catch (error) {
      run.status = 'failed';
      run.finishedAt = new Date();
      await this.runs.save(run);
      throw error;
    } finally {
      this.running = false;
    }
  }
}
