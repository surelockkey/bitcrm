import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { TRACE_ID_HEADER } from './logger.constants';
import { storage } from './trace-storage';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const traceId =
      (req.headers[TRACE_ID_HEADER] as string) || randomUUID().slice(0, 8);

    // Store in async-local-storage so non-HTTP code (SQS handlers) can access it
    storage.run(traceId, () => {
      // pino-http reads req.id and attaches it to every log in this request
      (req as any).id = traceId;
      next();
    });
  }
}
