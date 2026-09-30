import { BadRequestException } from '@nestjs/common';
import { LocationType } from '@bitcrm/types';
import { LocationsRepository } from 'src/stock/locations.repository';
import { createMockDynamoDbService } from '../mocks';

/**
 * The one place that reads a location of either kind by key or lists a kind
 * whole — what the product stock view and the transfer forms need, without
 * pulling the containers and warehouses modules into StockModule.
 */
describe('LocationsRepository', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: LocationsRepository;

  const warehouseRow = {
    PK: 'WAREHOUSE#wh-1',
    SK: 'METADATA',
    GSI1PK: 'LOCATION#WAREHOUSE',
    GSI1SK: '(1) store#wh-1',
    id: 'wh-1',
    name: '(1) STORE',
    address: '123 Main St',
    status: 'active',
    createdAt: '2026-09-11T11:34:07.000Z',
    updatedAt: '2026-09-11T11:34:07.000Z',
    externalId: 'workiz:location:255',
  };

  const containerRow = {
    PK: 'CONTAINER#container-1',
    SK: 'METADATA',
    GSI1PK: 'LOCATION#CONTAINER',
    GSI1SK: '(12) mike#container-1',
    id: 'container-1',
    name: '(12) MIKE',
    description: 'North route',
    technicianId: 'tech-1',
    technicianName: 'Mike Ross',
    department: 'Atlanta',
    status: 'archived',
    createdAt: '2026-09-11T11:34:07.000Z',
    updatedAt: '2026-09-11T11:34:07.000Z',
  };

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new LocationsRepository(dynamoDb as any);
  });

  describe('findLocation', () => {
    it('reads a warehouse by its key and answers a summary', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: warehouseRow });

      const location = await repository.findLocation(LocationType.WAREHOUSE, 'wh-1');

      expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'WAREHOUSE#wh-1',
        SK: 'METADATA',
      });
      expect(location).toEqual({
        type: 'warehouse',
        id: 'wh-1',
        name: '(1) STORE',
        status: 'active',
      });
    });

    // Технік і відділ потрібні попапу стоку, щоб показати техніку лише його фургон.
    it('reads a container by its key, whatever its status, with its technician and department', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: containerRow });

      const location = await repository.findLocation(LocationType.CONTAINER, 'container-1');

      expect(dynamoDb.client.send.mock.calls[0][0].input.Key).toEqual({
        PK: 'CONTAINER#container-1',
        SK: 'METADATA',
      });
      expect(location).toEqual({
        type: 'container',
        id: 'container-1',
        name: '(12) MIKE',
        description: 'North route',
        technicianId: 'tech-1',
        department: 'Atlanta',
        status: 'archived',
      });
    });

    it('answers null when there is no such location', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      expect(await repository.findLocation(LocationType.WAREHOUSE, 'missing')).toBeNull();
    });

    it('labels a container written before containers had a name the way the list does', async () => {
      const { name: _dropped, ...noName } = containerRow;
      dynamoDb.client.send.mockResolvedValue({ Item: noName });

      const location = await repository.findLocation(LocationType.CONTAINER, 'container-1');

      expect(location!.name).toBe("Mike Ross's van");
    });

    it('rejects the supplier pseudo-location without a read', async () => {
      await expect(
        repository.findLocation(LocationType.SUPPLIER, 'x'),
      ).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('queries the index partition of that kind in name order, placeholders left out', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [warehouseRow] });

      const locations = await repository.listAll(LocationType.WAREHOUSE);

      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.constructor.name).toBe('QueryCommand');
      expect(sent.input.IndexName).toBe('CategoryIndex');
      expect(sent.input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(sent.input.ExpressionAttributeValues).toEqual({ ':pk': 'LOCATION#WAREHOUSE', ':false': false });
      expect(sent.input.FilterExpression).toBe('(attribute_not_exists(placeholder) OR placeholder = :false)');
      expect(sent.input.Limit).toBeUndefined();
      expect(locations).toEqual([
        { type: 'warehouse', id: 'wh-1', name: '(1) STORE', status: 'active' },
      ]);
    });

    it('walks every page of the partition', async () => {
      const key = { PK: 'CONTAINER#a', SK: 'METADATA', GSI1PK: 'LOCATION#CONTAINER', GSI1SK: 'a#a' };
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ ...containerRow, id: 'a', name: 'A' }], LastEvaluatedKey: key })
        .mockResolvedValueOnce({ Items: [{ ...containerRow, id: 'b', name: 'B' }] });

      const locations = await repository.listAll(LocationType.CONTAINER);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
      expect(dynamoDb.client.send.mock.calls[0][0].input.ExpressionAttributeValues).toEqual({
        ':pk': 'LOCATION#CONTAINER',
        ':false': false,
      });
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual(key);
      expect(locations.map((l) => l.id)).toEqual(['a', 'b']);
      expect(locations.every((l) => l.type === 'container')).toBe(true);
    });

    it('rejects the supplier pseudo-location', async () => {
      await expect(repository.listAll(LocationType.SUPPLIER)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  /**
   * Заглушки Workiz не в списках, але одиниці на них не мають зникати: попап
   * стоку товару дочитує їх окремо й показує ту, що ще тримає товар.
   */
  describe('listPlaceholders', () => {
    it('reads only the placeholders of that kind, flagged', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...containerRow, id: 'c-ph', name: 'Workiz location #6142', placeholder: true }],
      });

      const locations = await repository.listPlaceholders(LocationType.CONTAINER);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.FilterExpression).toBe('placeholder = :true');
      expect(input.ExpressionAttributeValues).toEqual({ ':pk': 'LOCATION#CONTAINER', ':true': true });
      expect(locations).toEqual([expect.objectContaining({ id: 'c-ph', placeholder: true })]);
    });
  });

  it('still reads a placeholder by id, flagged', async () => {
    dynamoDb.client.send.mockResolvedValue({ Item: { ...containerRow, placeholder: true } });

    expect(await repository.findLocation(LocationType.CONTAINER, 'container-1')).toMatchObject({
      id: 'container-1',
      placeholder: true,
    });
  });
});
