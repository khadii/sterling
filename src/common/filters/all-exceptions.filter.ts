import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const details =
      typeof body === 'object'
        ? (body as { message?: string | string[]; error?: string })
        : undefined;
    const requestId = String(request.headers['x-request-id'] ?? 'unknown');

    if (status >= 500) {
      const stack =
        exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(
        `${request.method} ${request.url} failed requestId=${requestId}`,
        stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      message:
        typeof body === 'string'
          ? body
          : (details?.message ?? 'Internal server error'),
      error: details?.error ?? HttpStatus[status] ?? 'Error',
      path: request.url,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
