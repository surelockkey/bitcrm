import { Test } from '@nestjs/testing';
import { DynamoDbModule, DynamoDbService } from '@bitcrm/shared';
import { CommissionReportModule } from 'src/commission-report/commission-report.module';
import { CommissionReportService } from 'src/commission-report/commission-report.service';
import { CommissionReportController } from 'src/commission-report/commission-report.controller';

/** The service spec builds the class with mocks; this proves the module resolves on its own, as AppModule loads it. */
describe('CommissionReportModule', () => {
  it('resolves its controller and service with only the DynamoDB client from outside', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DynamoDbModule, CommissionReportModule] })
      .overrideProvider(DynamoDbService)
      .useValue({ client: { send: jest.fn() } })
      .compile();
    expect(moduleRef.get(CommissionReportService)).toBeInstanceOf(CommissionReportService);
    expect(moduleRef.get(CommissionReportController)).toBeInstanceOf(CommissionReportController);
  });
});
