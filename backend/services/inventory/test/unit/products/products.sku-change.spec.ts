import { ConflictException } from '@nestjs/common';
import { ProductsRepository } from 'src/products/products.repository';
import { ProductsService } from 'src/products/products.service';
import {
  createMockCreateProductDto,
  createMockDynamoDbService,
  createMockInventoryLogService,
  createMockItemCategoriesService,
  createMockProduct,
  createMockProductsCacheService,
  createMockProductsRepository,
  createMockS3Service,
} from '../mocks';

const cancelled = (codes: string[]) =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: codes.map((Code) => ({ Code })),
  });

/** Workiz lets the SKU ("Model #") be edited; BitCRM moves the SKU claim with it. */
describe('ProductsRepository.changeSku', () => {
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;
  let repository: ProductsRepository;

  beforeEach(() => {
    dynamoDb = createMockDynamoDbService();
    repository = new ProductsRepository(dynamoDb as any);
  });

  it('takes the new claim, drops the old one and rewrites sku / searchSku in one transaction', async () => {
    dynamoDb.client.send.mockResolvedValueOnce({});

    await repository.changeSku('p1', 'OLD-1', 'New-2');

    const command = dynamoDb.client.send.mock.calls[0][0];
    expect(command.constructor.name).toBe('TransactWriteCommand');
    const [put, del, update] = command.input.TransactItems;
    expect(put.Put).toMatchObject({
      Item: { PK: 'SKU#New-2', SK: 'PRODUCT', productId: 'p1' },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    expect(del.Delete).toMatchObject({
      Key: { PK: 'SKU#OLD-1', SK: 'PRODUCT' },
      ConditionExpression: 'attribute_not_exists(PK) OR productId = :id',
      ExpressionAttributeValues: { ':id': 'p1' },
    });
    expect(update.Update).toMatchObject({
      Key: { PK: 'PRODUCT#p1', SK: 'METADATA' },
      ConditionExpression: '#sku = :from',
      ExpressionAttributeValues: expect.objectContaining({ ':to': 'New-2', ':from': 'OLD-1', ':search': 'new-2' }),
    });
  });

  it('a SKU another product holds is a 409', async () => {
    dynamoDb.client.send.mockRejectedValueOnce(cancelled(['ConditionalCheckFailed', 'None', 'None']));
    await expect(repository.changeSku('p1', 'A', 'TAKEN')).rejects.toThrow(
      new ConflictException('Product with SKU "TAKEN" already exists'),
    );
  });

  it('an internal SKU is marked; a typed one clears the mark', async () => {
    dynamoDb.client.send.mockResolvedValue({});

    await repository.changeSku('p1', 'OWN-1', 'ITEM-42', { generated: true });
    await repository.changeSku('p1', 'ITEM-42', 'OWN-2');

    const generated = dynamoDb.client.send.mock.calls[0][0].input.TransactItems[2].Update;
    expect(generated.UpdateExpression).toBe(
      'SET #sku = :to, searchSku = :search, updatedAt = :now, skuGenerated = :generated',
    );
    expect(generated.ExpressionAttributeValues[':generated']).toBe(true);
    const typed = dynamoDb.client.send.mock.calls[1][0].input.TransactItems[2].Update;
    expect(typed.UpdateExpression).toBe('SET #sku = :to, searchSku = :search, updatedAt = :now REMOVE skuGenerated');
  });

  it('a row changed in between is a 409 of its own', async () => {
    dynamoDb.client.send.mockRejectedValueOnce(cancelled(['None', 'None', 'ConditionalCheckFailed']));
    await expect(repository.changeSku('p1', 'A', 'B')).rejects.toThrow(/changed while saving/);
  });
});

describe('ProductsService.update — SKU', () => {
  let repository: ReturnType<typeof createMockProductsRepository> & { changeSku: jest.Mock };
  let cache: ReturnType<typeof createMockProductsCacheService>;
  let log: ReturnType<typeof createMockInventoryLogService>;
  let service: ProductsService;

  beforeEach(() => {
    repository = { ...createMockProductsRepository(), changeSku: jest.fn() };
    cache = createMockProductsCacheService();
    log = createMockInventoryLogService();
    service = new ProductsService(
      repository as any,
      cache as any,
      createMockS3Service() as any,
      undefined,
      createMockItemCategoriesService() as any,
      undefined,
      log as any,
    );
    cache.get.mockResolvedValue(createMockProduct({ sku: 'SKU-001' }));
    repository.update.mockImplementation(async (_id, attrs) => createMockProduct(attrs));
  });

  it('moves the product to a new (trimmed) SKU before the other fields, and logs it', async () => {
    await service.update('prod-1', { sku: '  SKU-002 ', name: 'Renamed' } as any);

    expect(repository.changeSku).toHaveBeenCalledWith('prod-1', 'SKU-001', 'SKU-002');
    expect(repository.update).toHaveBeenCalledWith('prod-1', { name: 'Renamed' });
    expect(repository.changeSku.mock.invocationCallOrder[0]).toBeLessThan(
      repository.update.mock.invocationCallOrder[0],
    );
    expect(log.record).toHaveBeenCalledWith(
      expect.objectContaining({ changedFields: expect.arrayContaining(['sku', 'name']) }),
    );
  });

  it('the same SKU sent back is no change', async () => {
    await service.update('prod-1', { sku: 'SKU-001' } as any);
    expect(repository.changeSku).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith('prod-1', {});
  });

  describe('a blank SKU — "no SKU of its own", as an emptied Workiz SKU / Model #', () => {
    it('replaces a typed SKU with a marked internal one', async () => {
      cache.get.mockResolvedValue(createMockProduct({ sku: 'SKU-001', number: 42 }));
      await service.update('prod-1', { sku: '   ' } as any);
      expect(repository.changeSku).toHaveBeenCalledWith('prod-1', 'SKU-001', 'ITEM-42', { generated: true });
    });

    it("keeps the importer's WZ- stand-in, only marking it", async () => {
      cache.get.mockResolvedValue(createMockProduct({ sku: 'WZ-2475', workizSerial: 'KW1' } as any));
      await service.update('prod-1', { sku: '' } as any);
      expect(repository.changeSku).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledWith('prod-1', { skuGenerated: true });
    });

    it('an item already on an internal SKU is left as it is', async () => {
      cache.get.mockResolvedValue(createMockProduct({ sku: 'ITEM-42', skuGenerated: true }));
      await service.update('prod-1', { sku: '' } as any);
      expect(repository.changeSku).not.toHaveBeenCalled();
      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(repository.update).toHaveBeenCalledWith('prod-1', {});
    });

    it('an internal SKU someone typed already gets a random tail', async () => {
      cache.get.mockResolvedValue(createMockProduct({ sku: 'SKU-001', number: 42 }));
      repository.changeSku
        .mockRejectedValueOnce(new ConflictException('Product with SKU "ITEM-42" already exists'))
        .mockResolvedValueOnce(undefined);
      await service.update('prod-1', { sku: '' } as any);
      expect(repository.changeSku).toHaveBeenLastCalledWith(
        'prod-1',
        'SKU-001',
        expect.stringMatching(/^ITEM-42-[0-9a-f]{6}$/),
        { generated: true },
      );
    });
  });

  it('a taken SKU stops the edit before anything else is written', async () => {
    repository.changeSku.mockRejectedValue(new ConflictException('Product with SKU "X" already exists'));
    await expect(service.update('prod-1', { sku: 'X', name: 'N' } as any)).rejects.toThrow(ConflictException);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('ProductsService.create — SKU', () => {
  let repository: ReturnType<typeof createMockProductsRepository>;
  let service: ProductsService;

  beforeEach(() => {
    repository = createMockProductsRepository();
    repository.nextNumber.mockResolvedValue(3551);
    service = new ProductsService(
      repository as any,
      createMockProductsCacheService() as any,
      createMockS3Service() as any,
      undefined,
      createMockItemCategoriesService() as any,
      undefined,
      createMockInventoryLogService() as any,
    );
  });

  it('left out or blank: an internal ITEM-<number>, marked skuGenerated', async () => {
    const { sku: _sku, ...withoutSku } = createMockCreateProductDto();
    const a = await service.create(withoutSku as any);
    const b = await service.create(createMockCreateProductDto({ sku: '  ' }));
    expect(a).toMatchObject({ sku: 'ITEM-3551', skuGenerated: true });
    expect(b).toMatchObject({ sku: 'ITEM-3551', skuGenerated: true });
    expect(repository.create.mock.calls[0][0]).toMatchObject({ sku: 'ITEM-3551', skuGenerated: true });
  });

  it('a typed SKU is kept as sent, unmarked — old clients work as before', async () => {
    const p = await service.create(createMockCreateProductDto({ sku: 'LOCK-1' }));
    expect(p.sku).toBe('LOCK-1');
    expect('skuGenerated' in p).toBe(false);
  });

  it('an internal SKU that clashes gets a random tail; a typed one that clashes is the 409', async () => {
    repository.create
      .mockRejectedValueOnce(new ConflictException('taken'))
      .mockResolvedValueOnce(undefined);
    const p = await service.create(createMockCreateProductDto({ sku: '' }));
    expect(p.sku).toMatch(/^ITEM-3551-[0-9a-f]{6}$/);

    repository.create.mockRejectedValueOnce(new ConflictException('Product with SKU "LOCK-1" already exists'));
    await expect(service.create(createMockCreateProductDto({ sku: 'LOCK-1' }))).rejects.toThrow(ConflictException);
  });
});
