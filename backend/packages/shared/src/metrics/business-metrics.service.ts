import { Injectable } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { MetricsService } from './metrics.service';
import { BUSINESS_METRIC_PREFIX } from './metrics.constants';

@Injectable()
export class BusinessMetricsService {
  public readonly entityCreated: Counter;
  public readonly entityUpdated: Counter;
  public readonly entityDeleted: Counter;

  public readonly eventsPublished: Counter;
  public readonly eventsFailed: Counter;

  public readonly sqsMessagesProcessed: Counter;
  public readonly sqsProcessingDuration: Histogram;

  public readonly cacheHits: Counter;
  public readonly cacheMisses: Counter;

  public readonly internalHttpDuration: Histogram;
  public readonly internalHttpErrors: Counter;

  public readonly dealStageTransitions: Counter;
  public readonly dealProductsAdded: Counter;
  public readonly dealTechAssignments: Counter;

  public readonly stockTransfers: Counter;
  public readonly stockDeductions: Counter;

  constructor(metricsService: MetricsService) {
    const p = BUSINESS_METRIC_PREFIX;

    this.entityCreated = metricsService.createCounter(
      `${p}_entity_created_total`,
      'Total entities created',
      ['entity_type'],
    );
    this.entityUpdated = metricsService.createCounter(
      `${p}_entity_updated_total`,
      'Total entities updated',
      ['entity_type'],
    );
    this.entityDeleted = metricsService.createCounter(
      `${p}_entity_deleted_total`,
      'Total entities deleted',
      ['entity_type'],
    );

    this.eventsPublished = metricsService.createCounter(
      `${p}_events_published_total`,
      'Total SNS events published',
      ['event_type'],
    );
    this.eventsFailed = metricsService.createCounter(
      `${p}_events_failed_total`,
      'Total SNS publish failures',
      ['event_type'],
    );

    this.sqsMessagesProcessed = metricsService.createCounter(
      `${p}_sqs_messages_processed_total`,
      'Total SQS messages processed',
      ['event_type', 'status'],
    );
    this.sqsProcessingDuration = metricsService.createHistogram(
      `${p}_sqs_processing_duration_seconds`,
      'SQS message processing duration',
      ['event_type'],
    );

    this.cacheHits = metricsService.createCounter(
      `${p}_cache_hits_total`,
      'Cache hits',
      ['entity_type'],
    );
    this.cacheMisses = metricsService.createCounter(
      `${p}_cache_misses_total`,
      'Cache misses',
      ['entity_type'],
    );

    this.internalHttpDuration = metricsService.createHistogram(
      `${p}_internal_http_duration_seconds`,
      'Internal service-to-service HTTP call duration',
      ['target_service', 'operation'],
    );
    this.internalHttpErrors = metricsService.createCounter(
      `${p}_internal_http_errors_total`,
      'Internal HTTP call errors',
      ['target_service', 'operation'],
    );

    this.dealStageTransitions = metricsService.createCounter(
      `${p}_deal_stage_transitions_total`,
      'Deal stage transitions',
      ['from_stage', 'to_stage'],
    );
    this.dealProductsAdded = metricsService.createCounter(
      `${p}_deal_products_added_total`,
      'Products added to deals',
    );
    this.dealTechAssignments = metricsService.createCounter(
      `${p}_deal_tech_assignments_total`,
      'Technician assignments to deals',
    );

    this.stockTransfers = metricsService.createCounter(
      `${p}_stock_transfers_total`,
      'Stock transfers executed',
      ['type'],
    );
    this.stockDeductions = metricsService.createCounter(
      `${p}_stock_deductions_total`,
      'Stock deductions from containers',
    );
  }
}
