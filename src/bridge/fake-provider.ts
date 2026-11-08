import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import { FakeProviderTransferEntity } from '../persistence/entities.js';
import { redactDepositInstructions } from './deposit-instructions.js';
import { ProviderCallError, ProviderTransfer, CreateProviderTransfer } from './types.js';

const NEXT_HAPPY: Record<string, string> = {
  awaiting_funds: 'funds_received',
  funds_received: 'payment_submitted',
  payment_submitted: 'payment_processed',
};

/**
 * Deterministic local stand-in. It persists its own rows in
 * fake_provider_transfers and never calls Bridge. Advancing a record does not
 * move money, create a chain transaction, or approve KYC.
 */
@Injectable()
export class FakeBridgeProvider {
  readonly mode = 'fake' as const;
  readonly settlementAuthority = 'local_fake_not_bridge' as const;

  constructor(
    @InjectRepository(FakeProviderTransferEntity)
    private readonly records: Repository<FakeProviderTransferEntity>,
  ) {}

  async createTransfer(input: CreateProviderTransfer): Promise<ProviderTransfer> {
    const existing = await this.records.findOne({ where: { idempotencyKey: input.outboundIdempotencyKey } });
    if (existing) return this.toTransfer(existing);
    const now = new Date();
    const id = deterministicId(input.outboundIdempotencyKey);
    const transfer = this.build(id, 'awaiting_funds', input, now, now);
    const row = this.records.create({
      providerTransferId: id,
      idempotencyKey: input.outboundIdempotencyKey,
      state: 'awaiting_funds',
      payload: forStorage(transfer) as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
    try {
      await this.records.save(row);
    } catch (error) {
      const raced = await this.records.findOne({ where: { idempotencyKey: input.outboundIdempotencyKey } });
      if (raced) return this.toTransfer(raced);
      throw error;
    }
    return transfer;
  }

  async getTransfer(providerTransferId: string): Promise<ProviderTransfer> {
    const row = await this.records.findOne({ where: { providerTransferId } });
    if (!row) throw new ProviderCallError(404, 'provider_not_found');
    return this.toTransfer(row);
  }

  async deleteTransfer(providerTransferId: string): Promise<ProviderTransfer> {
    return this.records.manager.transaction(async (manager) => {
      const row = await manager.findOne(FakeProviderTransferEntity, {
        where: { providerTransferId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new ProviderCallError(404, 'provider_not_found');
      if (row.state !== 'awaiting_funds') throw new ProviderCallError(409, 'cancel_not_allowed');
      row.state = 'canceled';
      row.updatedAt = new Date();
      const payload = this.toTransfer(row);
      payload.state = 'canceled';
      payload.updatedAt = row.updatedAt.toISOString();
      row.payload = forStorage(payload) as unknown as Record<string, unknown>;
      await manager.save(row);
      return payload;
    });
  }

  async advance(providerTransferId: string): Promise<ProviderTransfer> {
    return this.records.manager.transaction(async (manager) => {
      const row = await manager.findOne(FakeProviderTransferEntity, {
        where: { providerTransferId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new ProviderCallError(404, 'provider_not_found');
      const next = NEXT_HAPPY[row.state];
      if (!next) throw new ProviderCallError(409, 'fake_provider_cannot_advance');
      row.state = next;
      row.updatedAt = new Date();
      const payload = this.toTransfer(row);
      payload.state = next;
      payload.updatedAt = row.updatedAt.toISOString();
      if (next === 'payment_processed') {
        payload.receipt = {
          ...(payload.receipt ?? {}),
          destination_tx_hash: 'fake-not-a-chain-transaction',
        };
      }
      row.payload = forStorage(payload) as unknown as Record<string, unknown>;
      await manager.save(row);
      return payload;
    });
  }

  private build(
    id: string,
    state: string,
    input: CreateProviderTransfer,
    createdAt: Date,
    updatedAt: Date,
  ): ProviderTransfer {
    const fiatSource = ['usd', 'eur', 'mxn', 'brl', 'cop', 'gbp'].includes(input.source.currency);
    return {
      id,
      state,
      amount: input.amount,
      currency: null,
      developerFee: input.developerFee,
      onBehalfOf: input.onBehalfOf,
      clientReferenceId: input.clientReferenceId,
      source: {
        paymentRail: input.source.paymentRail,
        currency: input.source.currency,
        fromAddress: input.source.fromAddress ?? null,
      },
      destination: {
        paymentRail: input.destination.paymentRail,
        currency: input.destination.currency,
        toAddress: input.destination.toAddress ?? null,
        externalAccountId: input.destination.externalAccountId ?? null,
      },
      depositInstructions: fiatSource
        ? {
            payment_rail: input.source.paymentRail,
            amount: input.amount,
            currency: input.source.currency,
            deposit_message: 'FAKE-NOT-BRIDGE',
            bank_name: 'LOCAL FAKE PROVIDER — NOT A BANK',
          }
        : {
            payment_rail: input.source.paymentRail,
            amount: input.amount,
            currency: input.source.currency,
            to_address: 'fake-not-a-chain-address',
            from_address: input.source.fromAddress ?? 'fake-not-a-chain-address',
          },
      receipt: {
        initial_amount: input.amount,
        developer_fee: input.developerFee ?? '0.0',
        exchange_fee: '0.0',
        subtotal_amount: input.amount,
        final_amount: input.amount,
      },
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    };
  }

  private toTransfer(row: FakeProviderTransferEntity): ProviderTransfer {
    const payload = row.payload as unknown as ProviderTransfer;
    const transfer: ProviderTransfer = { ...payload, id: row.providerTransferId, state: row.state };
    if (transfer.depositInstructions?.bank_name === 'LOCAL FAKE PROVIDER — NOT A BANK') {
      transfer.depositInstructions = {
        ...transfer.depositInstructions,
        bank_address: 'Not a real bank address',
        bank_routing_number: '000000000',
        bank_account_number: '0000000000',
        bank_beneficiary_name: 'FAKE BENEFICIARY — NOT BRIDGE',
        bank_beneficiary_address: 'Not a real address',
      };
    }
    return transfer;
  }
}

function forStorage(transfer: ProviderTransfer): ProviderTransfer {
  return {
    ...transfer,
    depositInstructions: redactDepositInstructions(transfer.depositInstructions),
  };
}

function deterministicId(idempotencyKey: string): string {
  const namespace = Buffer.from('b8d1c5a27e345b909c1a000000000001', 'hex');
  const hash = createHash('sha1').update(namespace).update(`local-fake:${idempotencyKey}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
