import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Counter, Histogram } from 'prom-client';
import { MetricsService } from './metrics.service';
import { HTTP_REQUEST_DURATION, HTTP_REQUESTS_TOTAL } from './metrics.constants';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  private readonly requestDuration: Histogram;
  private readonly requestsTotal: Counter;

  constructor(metricsService: MetricsService) {
    this.requestDuration = metricsService.createHistogram(
      HTTP_REQUEST_DURATION,
      'HTTP request duration in seconds',
      ['method', 'route', 'status_code'],
      [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    );
    this.requestsTotal = metricsService.createCounter(
      HTTP_REQUESTS_TOTAL,
      'Total HTTP requests',
      ['method', 'route', 'status_code'],
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const method = req.method;
    const route = req.route?.path || req.path;
    const timer = this.requestDuration.startTimer({ method, route });

    return next.handle().pipe(
      tap({
        next: () => {
          const statusCode = context.switchToHttp().getResponse().statusCode;
          timer({ status_code: String(statusCode) });
          this.requestsTotal.inc({
            method,
            route,
            status_code: String(statusCode),
          });
        },
        error: (err) => {
          const statusCode = err.status || 500;
          timer({ status_code: String(statusCode) });
          this.requestsTotal.inc({
            method,
            route,
            status_code: String(statusCode),
          });
        },
      }),
    );
  }
}
