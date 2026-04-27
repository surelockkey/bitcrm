import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { BusinessMetricsService } from './business-metrics.service';
import { METRICS_SERVICE_NAME } from './metrics.constants';

export interface MetricsModuleConfig {
  serviceName: string;
}

@Global()
@Module({})
export class MetricsModule {
  static forRoot(config: MetricsModuleConfig): DynamicModule {
    return {
      module: MetricsModule,
      controllers: [MetricsController],
      providers: [
        { provide: METRICS_SERVICE_NAME, useValue: config.serviceName },
        MetricsService,
        BusinessMetricsService,
        {
          provide: APP_INTERCEPTOR,
          useClass: HttpMetricsInterceptor,
        },
      ],
      exports: [MetricsService, BusinessMetricsService],
    };
  }
}
