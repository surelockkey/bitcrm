import { DynamicModule, Global, Module } from '@nestjs/common';
import { SnsPublisherService } from './sns-publisher.service';
import { SqsConsumerService } from './sqs-consumer.service';
import { PublisherOptions, ConsumerOptions } from './events.interfaces';

export interface EventsModuleConfig {
  publisher?: PublisherOptions & { source?: string };
  consumer?: ConsumerOptions;
}

@Global()
@Module({})
export class EventsModule {
  static forRoot(config: EventsModuleConfig): DynamicModule {
    const providers: any[] = [];
    const exports: any[] = [];

    if (config.publisher) {
      providers.push({
        provide: SnsPublisherService,
        useFactory: () =>
          new SnsPublisherService(config.publisher!, config.publisher!.source),
      });
      exports.push(SnsPublisherService);
    }

    if (config.consumer) {
      providers.push({
        provide: SqsConsumerService,
        useFactory: () => new SqsConsumerService(config.consumer!),
      });
      exports.push(SqsConsumerService);
    }

    return {
      module: EventsModule,
      providers,
      exports,
    };
  }
}
