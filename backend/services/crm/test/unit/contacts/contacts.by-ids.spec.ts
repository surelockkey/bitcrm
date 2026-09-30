/**
 * `POST /contacts/by-ids` — the page of a server-paged list resolves the
 * contacts it shows in one call instead of the browser holding every
 * contact (web-deals-scale design, steps 1 and 8). Masked like any other
 * public contact route.
 */
import { ContactsRepository } from 'src/contacts/contacts.repository';
import { ContactsService } from 'src/contacts/contacts.service';
import { ContactsController } from 'src/contacts/contacts.controller';
import {
  createMockContact,
  createMockContactsRepository,
  createMockDynamoDbService,
} from '../mocks';

describe('ContactsRepository.findByIds', () => {
  it('batch-gets in chunks of 100 and drops the ids that no longer exist', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new ContactsRepository(dynamoDb as any);
    const ids = Array.from({ length: 150 }, (_, i) => `c-${i}`);
    dynamoDb.client.send.mockImplementation(async (cmd: any) => {
      const keys = cmd.input.RequestItems[Object.keys(cmd.input.RequestItems)[0]].Keys as { PK: string }[];
      expect(keys.length).toBeLessThanOrEqual(100);
      return {
        Responses: {
          [Object.keys(cmd.input.RequestItems)[0]]: keys
            .filter((k) => k.PK !== 'CONTACT#c-7')
            .map((k) => ({ ...createMockContact({ id: k.PK.replace('CONTACT#', '') }), PK: k.PK, SK: 'METADATA' })),
        },
      };
    });

    const found = await repository.findByIds(ids);

    expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    expect(found.length).toBe(149);
    expect(found.find((c) => c.id === 'c-7')).toBeUndefined();
  });

  it('an empty list asks nothing', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new ContactsRepository(dynamoDb as any);
    expect(await repository.findByIds([])).toEqual([]);
    expect(dynamoDb.client.send).not.toHaveBeenCalled();
  });

  it('retries the keys DynamoDB left unprocessed', async () => {
    const dynamoDb = createMockDynamoDbService();
    const repository = new ContactsRepository(dynamoDb as any);
    const table = (repository as any).tableName as string;
    dynamoDb.client.send
      .mockResolvedValueOnce({
        Responses: { [table]: [{ ...createMockContact({ id: 'c-1' }), PK: 'CONTACT#c-1', SK: 'METADATA' }] },
        UnprocessedKeys: { [table]: { Keys: [{ PK: 'CONTACT#c-2', SK: 'METADATA' }] } },
      })
      .mockResolvedValueOnce({
        Responses: { [table]: [{ ...createMockContact({ id: 'c-2' }), PK: 'CONTACT#c-2', SK: 'METADATA' }] },
      });
    const found = await repository.findByIds(['c-1', 'c-2']);
    expect(found.map((c) => c.id).sort()).toEqual(['c-1', 'c-2']);
  });
});

describe('ContactsService.findByIds', () => {
  it('de-duplicates and keeps the caller order', async () => {
    const repo = createMockContactsRepository();
    repo.findByIds = jest.fn().mockResolvedValue([createMockContact({ id: 'b' }), createMockContact({ id: 'a' })]);
    const service = new ContactsService(repo as any, {} as any, {} as any, {} as any);
    const out = await service.findByIds(['a', 'b', 'a']);
    expect(repo.findByIds).toHaveBeenCalledWith(['a', 'b']);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('ContactsController.findByIds', () => {
  it('masks the numbers unless the caller holds contacts.view_numbers', async () => {
    const service = { findByIds: jest.fn().mockResolvedValue([createMockContact({ id: 'a', phones: ['+14045551234'] })]) };
    const controller = new ContactsController(service as any);
    const noNumbers = { permissions: { contacts: { view: true, view_numbers: false } } } as any;
    const res = await controller.findByIds({ ids: ['a'] }, noNumbers);
    expect(res.data[0].phones).toEqual([]);
    expect(res.data[0].phoneCount).toBe(1);
    expect(res.data[0].phonesMasked).toBe(true);

    const withNumbers = { permissions: { contacts: { view: true, view_numbers: true } } } as any;
    const res2 = await controller.findByIds({ ids: ['a'] }, withNumbers);
    expect(res2.data[0].phones).toEqual(['+14045551234']);
  });
});
