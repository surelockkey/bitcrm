import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

@Injectable()
export class DynamoDbService {
  public readonly client: DynamoDBDocumentClient;

  constructor() {
    const ddbClient = new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    });
    this.client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
        // The services run a ValidationPipe with `transform: true`, so request
        // DTOs arrive as class instances (e.g. AddressDto). When one is written
        // to DynamoDB — the deal timeline stores the raw `newValue` — the
        // marshaller rejects it ("Unsupported type") unless told to treat class
        // instances as maps. Without this, updating a deal's address 500s.
        convertClassInstanceToMap: true,
      },
    });
  }
}
