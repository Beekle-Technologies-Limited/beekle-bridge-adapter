import { Body, Controller, Get, Headers, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Actor, MerchantGuard } from '../auth/actor.js';
import { AppError } from '../common/errors.js';
import { CreateTransferDto } from './dto.js';
import { TransfersService } from './transfers.service.js';

type RequestWithActor = Request & { actor: Actor; requestId?: string };

@ApiTags('transfers')
@ApiBearerAuth()
@ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Required on create. Retries must reuse it with the same body.' })
@UseGuards(MerchantGuard)
@Controller('v1/transfers')
export class TransfersController {
  constructor(@Inject(TransfersService) private readonly transfers: TransfersService) {}

  @Post()
  create(
    @Req() request: RequestWithActor,
    @Body() body: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9_.:-]{8,200}$/.test(idempotencyKey)) {
      throw new AppError(400, 'idempotency_key_required', 'Send an Idempotency-Key header of 8 to 200 safe characters.');
    }
    return this.transfers.create(request.actor, idempotencyKey, body, request.requestId ?? 'unknown');
  }

  @Get()
  list(@Req() request: RequestWithActor) {
    return this.transfers.list(request.actor);
  }

  @Get(':id/deposit-instructions')
  depositInstructions(@Req() request: RequestWithActor, @Param('id') id: string) {
    return this.transfers.depositInstructions(request.actor, id, request.requestId ?? 'unknown');
  }

  @Get(':id')
  get(@Req() request: RequestWithActor, @Param('id') id: string) {
    return this.transfers.get(request.actor, id);
  }

  @Post(':id/cancel')
  cancel(@Req() request: RequestWithActor, @Param('id') id: string) {
    return this.transfers.cancel(request.actor, id, request.requestId ?? 'unknown');
  }
}
