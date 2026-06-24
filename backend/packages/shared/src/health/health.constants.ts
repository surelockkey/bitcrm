/**
 * DI token for the list of DynamoDB table names the DynamoDbHealthIndicator
 * should DescribeTable when answering /health and /health/ready.
 */
export const HEALTH_DYNAMO_TABLES = Symbol('HEALTH_DYNAMO_TABLES');
