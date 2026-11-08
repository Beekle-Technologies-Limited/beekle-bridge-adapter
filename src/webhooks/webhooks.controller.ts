import { Controller, Inject, Post, Req } from '@nestjs/common';
import { RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { AppError } from '../common/errors.js';
import { WebhooksService } from './webhooks.service.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(@Inject(WebhooksService) private readonly webhooks: WebhooksService) {}

  @Post('bridge')
  receive(@Req() request: RawBodyRequest<Request>) {
    if (!request.rawBody) {
      throw new AppError(400, 'invalid_body', 'Raw body unavailable.');
    }
    return this.webhooks.handle(request.rawBody, request.header('x-webhook-signature'));
  }
}
