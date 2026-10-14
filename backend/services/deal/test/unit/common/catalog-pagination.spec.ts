/**
 * A catalog list is one GSI1 partition, but one Query answers at most 1 MB.
 * After the Workiz import the job-type partition alone holds 898 rows, so a
 * list that stops at the first page silently drops the rest. Every catalog
 * repository's `listAll` follows `LastEvaluatedKey` to the end.
 */
import { JobTypesRepository } from 'src/job-types/job-types.repository';
import { JobSourcesRepository } from 'src/job-sources/job-sources.repository';
import { JobTagsRepository } from 'src/job-tags/job-tags.repository';
import { CustomFieldsRepository } from 'src/custom-fields/custom-fields.repository';
import { JobStatusesRepository } from 'src/job-statuses/job-statuses.repository';
import { ServiceAreasRepository } from 'src/service-areas/service-areas.repository';
import { ExternalCompaniesRepository } from 'src/external-companies/external-companies.repository';
import { ClientTagsRepository } from 'src/client-tags/client-tags.repository';
import { queryAllPages } from 'src/common/utils/query-all-pages';
import { createMockDynamoDbService } from '../mocks';

const row = (id: string) => ({ id, name: `Name ${id}`, priority: 0, active: true, superStatus: 'submitted' });

const repositories: [string, new (db: any) => { listAll: (...a: any[]) => Promise<{ id: string }[]> }][] = [
  ['JobTypesRepository', JobTypesRepository],
  ['JobSourcesRepository', JobSourcesRepository],
  ['JobTagsRepository', JobTagsRepository],
  ['CustomFieldsRepository', CustomFieldsRepository],
  ['JobStatusesRepository', JobStatusesRepository],
  ['ServiceAreasRepository', ServiceAreasRepository],
  ['ExternalCompaniesRepository', ExternalCompaniesRepository],
  ['ClientTagsRepository', ClientTagsRepository],
];

describe.each(repositories)('%s.listAll', (_name, Repository) => {
  it('follows LastEvaluatedKey to the end of the partition', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [row('a'), row('b')], LastEvaluatedKey: { PK: 'b' } })
      .mockResolvedValueOnce({ Items: [row('c')] });

    const rows = await new Repository(dynamoDb as any).listAll();

    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    const second = dynamoDb.client.send.mock.calls[1][0].input;
    expect(second.ExclusiveStartKey).toEqual({ PK: 'b' });
    expect(second.IndexName).toBe(dynamoDb.client.send.mock.calls[0][0].input.IndexName);
  });
});

describe('queryAllPages', () => {
  it('reads every page and never sends an ExclusiveStartKey on the first', async () => {
    const dynamoDb = createMockDynamoDbService();
    dynamoDb.client.send
      .mockResolvedValueOnce({ Items: [{ n: 1 }], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: { k: 2 } })
      .mockResolvedValueOnce({});

    const items = await queryAllPages(dynamoDb.client as any, { TableName: 't', KeyConditionExpression: 'x' });

    expect(items).toEqual([{ n: 1 }]);
    expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
    expect(dynamoDb.client.send.mock.calls[0][0].input.ExclusiveStartKey).toBeUndefined();
    expect(dynamoDb.client.send.mock.calls[2][0].input.ExclusiveStartKey).toEqual({ k: 2 });
  });
});
