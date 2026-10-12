import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { describeError } from './describe-error';
import { getTraceId } from '../logger/trace-storage';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status: number;
    let message: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as Record<string, unknown>).message as string || exception.message;
    } else {
      // Not ours: an SDK, a peer service, a bug. Say what it was, not "Internal server error".
      ({ status, message } = describeError(exception));
    }
    const code = HttpStatus[status] || 'UNKNOWN_ERROR';

    // The trace id names the request in the logs — on a 5xx it is how a report gets found.
    const ref =
      status >= 500
        ? (ctx.getRequest?.() as (Request & { id?: string }) | undefined)?.id ?? getTraceId()
        : undefined;
    if (ref && typeof message === 'string') message = `${message} (ref ${ref})`;

    if (status >= 500) {
      this.logger.error(
        exception instanceof HttpException ? `${code}: ${message}` : 'Unhandled exception',
        exception instanceof Error ? exception.stack : exception,
      );
    } else if (status >= 400) {
      this.logger.warn(`${code}: ${message}`);
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(ref ? { ref } : {}),
      },
    });
  }
}
