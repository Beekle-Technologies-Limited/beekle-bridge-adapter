import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError } from './errors.js';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? null;
    if (exception instanceof AppError) {
      response.status(exception.status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details ?? null,
          requestId,
        },
      });
      return;
    }
    const detail = exception instanceof Error ? exception.stack ?? exception.message : 'unknown error';
    console.error(detail.split('\n').slice(0, 8).join('\n'));
    response.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Internal error',
        requestId,
      },
    });
  }
}
