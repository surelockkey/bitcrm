import { DynamicModule, Global, Module } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import Redis from 'ioredis';

import { ConnectivityOptions, Probe } from './connectivity.types';
import { ConnectivityCheckService } from './connectivity-check.service';
import { DependencyMetricsService } from './dependency-metrics.service';
import { DynamoDbProbe } from './probes/dynamodb.probe';
import { RedisProbe } from './probes/redis.probe';
import { S3Probe } from './probes/s3.probe';
import { SnsProbe } from './probes/sns.probe';
import { SqsProbe } from './probes/sqs.probe';
import { HttpProbe } from './probes/http.probe';
import { MetricsService } from '../metrics/metrics.service';

function awsClientConfig(
  endpoint: string | undefined,
  region: string,
): {
  region: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
} {
  if (!endpoint) return { region };
  return {
    region,
    endpoint,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  };
}

function buildProbes(opts: ConnectivityOptions): Probe[] {
  const probes: Probe[] = [];
  const region = process.env.AWS_REGION ?? 'us-east-1';
  const awsEndpoint = process.env.AWS_ENDPOINT;

  if (opts.dynamodb) {
    const ddbEndpoint = opts.dynamodb.endpoint ?? process.env.DYNAMODB_ENDPOINT;
    const client = new DynamoDBClient(
      awsClientConfig(ddbEndpoint, opts.dynamodb.region ?? region),
    );
    probes.push(new DynamoDbProbe(client, opts.dynamodb.tables ?? []));
  }

  if (opts.redis) {
    const url =
      typeof opts.redis === 'object' && opts.redis.url
        ? opts.redis.url
        : process.env.REDIS_URL ?? 'redis://localhost:6379';
    const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: false });
    probes.push(new RedisProbe(client));
  }

  if (opts.s3) {
    const endpoint = opts.s3.endpoint ?? awsEndpoint;
    const client = new S3Client({
      ...awsClientConfig(endpoint, opts.s3.region ?? region),
      ...(endpoint ? { forcePathStyle: true } : {}),
    });
    probes.push(new S3Probe(client, opts.s3.buckets));
  }

  if (opts.sns) {
    const client = new SNSClient(
      awsClientConfig(opts.sns.endpoint ?? awsEndpoint, opts.sns.region ?? region),
    );
    probes.push(new SnsProbe(client, opts.sns.topics));
  }

  if (opts.sqs) {
    const client = new SQSClient(
      awsClientConfig(opts.sqs.endpoint ?? awsEndpoint, opts.sqs.region ?? region),
    );
    probes.push(new SqsProbe(client, opts.sqs.queues));
  }

  if (opts.httpServices) {
    for (const t of opts.httpServices) {
      probes.push(new HttpProbe(t.name, t.url));
    }
  }

  return probes;
}

@Global()
@Module({})
export class ConnectivityModule {
  static forRoot(opts: ConnectivityOptions): DynamicModule {
    const probes = buildProbes(opts);
    return {
      module: ConnectivityModule,
      global: true,
      providers: [
        DependencyMetricsService,
        {
          provide: ConnectivityCheckService,
          useFactory: (metrics: DependencyMetricsService) =>
            new ConnectivityCheckService(probes, opts, metrics),
          inject: [DependencyMetricsService],
        },
      ],
      exports: [ConnectivityCheckService, DependencyMetricsService],
    };
  }
}
