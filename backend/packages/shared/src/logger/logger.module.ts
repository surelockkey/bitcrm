import { DynamicModule, Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { REDACT_PATHS } from './logger.constants';
import { CorrelationMiddleware } from './correlation.middleware';

export interface LoggerModuleConfig {
  serviceName: string;
}

@Global()
@Module({})
export class LoggerModule implements NestModule {
  static forRoot(config: LoggerModuleConfig): DynamicModule {
    const isProduction = process.env.NODE_ENV === 'production';
    const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

    return {
      module: LoggerModule,
      imports: [
        PinoLoggerModule.forRoot({
          pinoHttp: {
            level: logLevel,

            // Attach service name to every log line
            mixin: () => ({ service: config.serviceName }),

            // Use the trace ID set by CorrelationMiddleware
            genReqId: (req) => (req as any).id,

            // Rename pino-http's default 'reqId' to 'traceId'
            customProps: (req) => ({ traceId: (req as any).id }),

            // Redact sensitive values
            redact: {
              paths: REDACT_PATHS,
              censor: '[REDACTED]',
            },

            // Slim down what we log per request/response
            serializers: {
              req: (req) => ({
                method: req.method,
                url: req.url,
                userId: req.raw?.user?.id,
                roleId: req.raw?.user?.roleId,
              }),
              res: (res) => ({
                statusCode: res.statusCode,
              }),
            },

            // Pretty print in dev, JSON in production
            transport: isProduction
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: false,
                    translateTime: 'HH:MM:ss',
                    ignore: 'pid,hostname',
                  },
                },
          },
        }),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
