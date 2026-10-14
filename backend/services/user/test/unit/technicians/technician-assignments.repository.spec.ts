import { TechnicianAssignmentsRepository } from '../../../src/technicians/assignments/technician-assignments.repository';
import { createMockDynamoDbClient } from '../mocks';

describe('TechnicianAssignmentsRepository (unit)', () => {
  let client: ReturnType<typeof createMockDynamoDbClient>;
  let repo: TechnicianAssignmentsRepository;

  beforeEach(() => {
    client = createMockDynamoDbClient();
    repo = new TechnicianAssignmentsRepository({ client } as never);
  });

  describe('listAllApproved', () => {
    it('projects only the fields its readers use, and pages the whole partition', async () => {
      client.send
        .mockResolvedValueOnce({
          Items: [{ userId: 't-1', kind: 'job_type', catalogId: 'jt-1', status: 'approved' }],
          LastEvaluatedKey: { PK: 'x' },
        })
        .mockResolvedValueOnce({
          Items: [{ userId: 't-2', kind: 'job_type', catalogId: 'jt-2', status: 'approved' }],
        });

      const rows = await repo.listAllApproved('job_type');

      expect(rows.map((r) => r.catalogId)).toEqual(['jt-1', 'jt-2']);
      expect(client.send).toHaveBeenCalledTimes(2);
      const input = client.send.mock.calls[0][0].input;
      expect(input.IndexName).toBeDefined();
      expect(input.ExpressionAttributeValues[':pk']).toBe('JOBTYPE_STATUS#approved');
      const projected = (input.ProjectionExpression as string)
        .split(',')
        .map((n: string) => input.ExpressionAttributeNames[n.trim()]);
      expect(projected.sort()).toEqual(['catalogId', 'kind', 'status', 'userId']);
      expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'x' });
    });
  });
});
