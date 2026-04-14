// DynamoDB
export { DynamoDbModule } from './dynamodb/dynamodb.module';
export { DynamoDbService } from './dynamodb/dynamodb.service';

// Redis
export { RedisModule } from './redis/redis.module';
export { RedisService } from './redis/redis.service';

// Auth
export { AuthModule } from './auth/auth.module';
export { CognitoAuthGuard } from './auth/auth.guard';
export { Public, IS_PUBLIC_KEY } from './auth/public.decorator';
export { CurrentUser } from './auth/user.decorator';
export { PermissionGuard } from './auth/permission.guard';
export { RequirePermission, PERMISSION_KEY } from './auth/permission.decorator';
export { PermissionCacheReader } from './auth/permission-cache-reader';
export { getDataScopeFilter } from './auth/data-scope.util';
export { canTransitionStage } from './auth/stage-transition.util';

// Cognito Admin
export { CognitoAdminModule } from './cognito/cognito-admin.module';
export { CognitoAdminService } from './cognito/cognito-admin.service';

// Cognito Auth
export { CognitoAuthModule } from './cognito/cognito-auth.module';
export { CognitoAuthService } from './cognito/cognito-auth.service';

// Events
export { EventsModule, EventsModuleConfig } from './events/events.module';
export { SnsPublisherService } from './events/sns-publisher.service';
export { SqsConsumerService } from './events/sqs-consumer.service';
export {
  EventMessage,
  EventHandler,
  PublisherOptions,
  ConsumerOptions,
} from './events/events.interfaces';

// Errors
export { HttpExceptionFilter } from './errors/http-exception.filter';

// Logger
export { LoggerModule, LoggerModuleConfig } from './logger/logger.module';
export { CorrelationMiddleware } from './logger/correlation.middleware';
export { getTraceId, storage as traceStorage } from './logger/trace-storage';
export { TRACE_ID_HEADER, TRACE_ID_ATTRIBUTE } from './logger/logger.constants';
