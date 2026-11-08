import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppError } from '../common/errors.js';
import { capabilityMatrix, capabilitySummary, evaluateRoute } from './route-policy.js';

@ApiTags('capabilities')
@Controller('v1/capabilities')
export class CapabilitiesController {
  @Get()
  summary() {
    return {
      ...capabilitySummary(),
      settlement: 'not_live',
      notes: [
        'Listed asset support, orchestratable routes, and account availability are different. See /v1/capabilities/matrix.',
        'Stellar is present in the examined create-transfer rail enum and route explorer. This adapter does not orchestrate it.',
        'GHS, NGN, and RMB/CNY were absent from the examined create-transfer currency enum. This adapter will not send them. That is not a survey of every Bridge product.',
      ],
    };
  }

  @Get('matrix')
  matrix() {
    return capabilityMatrix();
  }

  @Get('evaluate')
  evaluate(
    @Query('sourceRail') sourceRail?: string,
    @Query('sourceCurrency') sourceCurrency?: string,
    @Query('destinationRail') destinationRail?: string,
    @Query('destinationCurrency') destinationCurrency?: string,
    @Query('amount') amount?: string,
  ) {
    if (!sourceRail || !sourceCurrency || !destinationRail || !destinationCurrency) {
      throw new AppError(400, 'route_query_required', 'Provide sourceRail, sourceCurrency, destinationRail, and destinationCurrency.');
    }
    return evaluateRoute({ sourceRail, sourceCurrency, destinationRail, destinationCurrency, amount });
  }
}
