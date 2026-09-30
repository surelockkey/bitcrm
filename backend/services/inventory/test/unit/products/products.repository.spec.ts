import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DynamoDbService } from '@bitcrm/shared';
import { ProductsRepository } from 'src/products/products.repository';
import { createMockProduct, createMockDynamoDbService } from '../mocks';

describe('ProductsRepository', () => {
  let repository: ProductsRepository;
  let dynamoDb: ReturnType<typeof createMockDynamoDbService>;

  beforeEach(async () => {
    dynamoDb = createMockDynamoDbService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsRepository,
        { provide: DynamoDbService, useValue: dynamoDb },
      ],
    }).compile();

    repository = module.get<ProductsRepository>(ProductsRepository);
  });

  describe('create', () => {
    it('should send TransactWriteCommand to create product and SKU lookup', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(product);

      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    // Пошук у списку — `contains` без урахування регістру, як у складів і
    // журналу: "lock" має знаходити "Lock Set", "Lock" — "padlock".
    it('writes the lowercased search attributes for name and sku', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.create(createMockProduct({ name: '  Lock Set ', sku: 'WZ-10707' }));

      const item = dynamoDb.client.send.mock.calls[0][0].input.TransactItems[0].Put.Item;
      expect(item.searchName).toBe('lock set');
      expect(item.searchSku).toBe('wz-10707');
    });

    it('should throw ConflictException on TransactionCanceledException', async () => {
      const product = createMockProduct();
      const error = new Error('Transaction cancelled');
      error.name = 'TransactionCanceledException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.create(product)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should rethrow non-transaction errors', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(repository.create(product)).rejects.toThrow('Network error');
    });
  });

  describe('findById', () => {
    it('should return product when found', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...product, PK: `PRODUCT#${product.id}`, SK: 'METADATA' },
      });

      const result = await repository.findById('prod-1');

      expect(result).toBeDefined();
      expect(result!.id).toBe('prod-1');
    });

    it('maps taxable, treating a missing flag as true', async () => {
      const product = createMockProduct();
      dynamoDb.client.send
        .mockResolvedValueOnce({ Item: { ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Item: { ...product, taxable: false, PK: 'PRODUCT#prod-1', SK: 'METADATA' } });

      expect((await repository.findById('prod-1'))!.taxable).toBe(true);
      expect((await repository.findById('prod-1'))!.taxable).toBe(false);
    });

    it('should return null when not found', async () => {
      dynamoDb.client.send.mockResolvedValue({ Item: undefined });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findBySku', () => {
    it('should query SKU lookup then get product', async () => {
      const product = createMockProduct();
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [{ productId: 'prod-1' }] })
        .mockResolvedValueOnce({
          Item: { ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
        });

      const result = await repository.findBySku('SKU-001');

      expect(result).toBeDefined();
      expect(result!.id).toBe('prod-1');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(2);
    });

    it('should return null if SKU lookup yields no items', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      const result = await repository.findBySku('NONEXISTENT');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return paginated results', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findAll(20);

      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeUndefined();
    });

    it('fills the page across reads instead of returning what one scan left', async () => {
      // Таблиця інвентарю тримає не лише товари: SKU#, STOCK#, CONTAINER#,
      // WAREHOUSE# — усе це Scan читає й викидає фільтром. `Limit` рахує
      // прочитане, тож на 50 приходило 4 товари, а зі статусом — 2, і сторінка
      // інвентарю відкривалась майже порожньою.
      const product = createMockProduct();
      const row = (id: string) => ({ ...product, id, PK: `PRODUCT#${id}`, SK: 'METADATA' });
      dynamoDb.client.send
        .mockResolvedValueOnce({ Items: [row('p1')], LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Items: [row('p2')], LastEvaluatedKey: { PK: 'X#2', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Items: [row('p3')], LastEvaluatedKey: undefined });

      const result = await repository.findAll(3);

      expect(result.items.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(3);
      // Таблиця скінчилась — курсора нема, хоч би якою короткою була остання читка.
      expect(result.nextCursor).toBeUndefined();
    });

    it('stops once the page is full, and points the cursor at the last row kept', async () => {
      const product = createMockProduct();
      const row = (id: string) => ({ ...product, id, PK: `PRODUCT#${id}`, SK: 'METADATA' });
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: [row('p1'), row('p2'), row('p3')],
        LastEvaluatedKey: { PK: 'X#9', SK: 'METADATA' },
      });

      const result = await repository.findAll(2);

      expect(result.items.map((p) => p.id)).toEqual(['p1', 'p2']);
      // Наступна сторінка має початися з p3, а не з того, де спинився Scan.
      expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64').toString())).toEqual({
        PK: 'PRODUCT#p2',
        SK: 'METADATA',
      });
    });

    it('should return nextCursor when there are more results', async () => {
      const product = createMockProduct();
      const lastKey = { PK: 'PRODUCT#prod-1', SK: 'METADATA' };
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: lastKey,
      });

      const result = await repository.findAll(1);

      expect(result.nextCursor).toBeDefined();
    });
  });

  describe('findByCategory', () => {
    it('should query GSI1 with category', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByCategory('Locks', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('findByType', () => {
    it('should query GSI2 with type', async () => {
      const product = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Items: [{ ...product, PK: 'PRODUCT#prod-1', SK: 'METADATA' }],
        LastEvaluatedKey: undefined,
      });

      const result = await repository.findByType('product', 20);

      expect(result.items).toHaveLength(1);
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Курсор, що не є base64url-JSON (зіпсований, з чужого списку), падав у
   * JSON.parse і виходив 500; `decodeIndexCursor` уже робив це правильно.
   */
  describe('cursors that are not its own', () => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

    it('refuses garbage with a 400 before any read — category, type and the whole list alike', async () => {
      await expect(repository.findByCategory('Locks', 20, '%%%')).rejects.toThrow(BadRequestException);
      await expect(repository.findByType('product', 20, '%%%')).rejects.toThrow(BadRequestException);
      await expect(repository.findAll(20, '%%%')).rejects.toThrow(BadRequestException);
      expect(dynamoDb.client.send).not.toHaveBeenCalled();
    });

    // Курсор списку за категорією на запит за типом: DynamoDB відповів би
    // ValidationException (500) — ключів TypeIndex у ньому нема.
    it('refuses a cursor without the keys of the index it resumes', async () => {
      const categoryCursor = encode({ PK: 'PRODUCT#p-1', SK: 'METADATA', GSI1PK: 'CATEGORY#Locks', GSI1SK: 'PRODUCT#p-1' });

      await expect(repository.findByType('product', 20, categoryCursor)).rejects.toThrow(BadRequestException);
      await expect(repository.findByCategory('Locks', 20, encode({ PK: 'PRODUCT#p-1' }))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still resumes from the cursors it hands out', async () => {
      const key = { PK: 'PRODUCT#p-1', SK: 'METADATA', GSI1PK: 'CATEGORY#Locks', GSI1SK: 'PRODUCT#p-1' };
      dynamoDb.client.send.mockResolvedValue({ Items: [] });

      await repository.findByCategory('Locks', 20, encode(key));
      await repository.findAll(20, encode({ PK: 'PRODUCT#p-1', SK: 'METADATA' }));

      expect(dynamoDb.client.send.mock.calls[0][0].input.ExclusiveStartKey).toEqual(key);
      expect(dynamoDb.client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ PK: 'PRODUCT#p-1', SK: 'METADATA' });
    });
  });

  describe('update', () => {
    it('should build correct SET expression and return updated product', async () => {
      const updated = createMockProduct({ name: 'Updated Product' });
      dynamoDb.client.send.mockResolvedValue({
        // Already filed on the stock-managed partition under its name: one write.
        Attributes: {
          ...updated,
          PK: 'PRODUCT#prod-1',
          SK: 'METADATA',
          GSI3PK: 'PRODUCTS#STOCK',
          GSI3SK: 'updated product#prod-1',
        },
      });

      const result = await repository.update('prod-1', { name: 'Updated Product' });

      expect(result.name).toBe('Updated Product');
      expect(dynamoDb.client.send).toHaveBeenCalledTimes(1);
    });

    it('should rebuild GSI keys when category changes', async () => {
      const updated = createMockProduct({ category: 'Safes' });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const result = await repository.update('prod-1', { category: 'Safes' });

      expect(result.category).toBe('Safes');
      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      // Verify GSI1PK is included in the update expression values
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('CATEGORY#Safes');
    });

    it('should rebuild GSI keys when type changes', async () => {
      const updated = createMockProduct({ type: 'service' as any });
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const result = await repository.update('prod-1', { type: 'service' as any });

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const input = sendCall.input;
      expect(JSON.stringify(input.ExpressionAttributeValues)).toContain('TYPE#service');
    });

    it('should skip immutable keys (id, sku)', async () => {
      const updated = createMockProduct();
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...updated, PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { id: 'new-id', sku: 'NEW-SKU', name: 'Updated' } as any);

      const sendCall = dynamoDb.client.send.mock.calls[0][0];
      const expressionNames = sendCall.input.ExpressionAttributeNames;
      expect(expressionNames).not.toHaveProperty('#id');
      expect(expressionNames).not.toHaveProperty('#sku');
    });

    it('REMOVEs a key handed in as an explicit undefined', async () => {
      // The contract the CSV re-import relies on to clear a stale workizType.
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockProduct(), PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { workizType: undefined, name: 'Kept' });

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toContain('REMOVE #workizType');
      expect(input.UpdateExpression).toContain('#name = :name');
      expect(input.ExpressionAttributeValues).not.toHaveProperty(':workizType');
    });

    // `null` з API означає "очистити поле": атрибут видаляється, а не
    // зберігається як DynamoDB NULL.
    it('REMOVEs a key handed in as null', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockProduct(), PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { brandId: null, reorderLevel: null, name: 'Kept' } as any);

      const input = dynamoDb.client.send.mock.calls[0][0].input;
      expect(input.UpdateExpression).toMatch(/REMOVE .*#brandId/);
      expect(input.UpdateExpression).toMatch(/REMOVE .*#reorderLevel/);
      expect(input.UpdateExpression).toContain('#name = :name');
      expect(input.ExpressionAttributeValues).not.toHaveProperty(':brandId');
      expect(input.ExpressionAttributeValues).not.toHaveProperty(':reorderLevel');
    });

    it('rewrites the search name when the name changes, and leaves it alone otherwise', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Attributes: { ...createMockProduct(), PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      await repository.update('prod-1', { name: ' Kwikset Deadbolt ' });
      await repository.update('prod-1', { costTech: 12 });

      const renamed = dynamoDb.client.send.mock.calls[0][0].input;
      expect(renamed.UpdateExpression).toContain('#searchName = :searchName');
      expect(renamed.ExpressionAttributeValues[':searchName']).toBe('kwikset deadbolt');
      expect(dynamoDb.client.send.mock.calls[1][0].input.UpdateExpression).not.toContain('searchName');
    });
  });

  describe('toProduct (search attributes)', () => {
    it('never leaks searchName and searchSku onto the entity', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          ...createMockProduct(),
          PK: 'PRODUCT#prod-1',
          SK: 'METADATA',
          searchName: 'test product',
          searchSku: 'sku-001',
        },
      });

      const product = (await repository.findById('prod-1')) as unknown as Record<string, unknown>;

      expect(product.searchName).toBeUndefined();
      expect(product.searchSku).toBeUndefined();
      expect(product.name).toBe('Test Product');
    });
  });
  /**
   * The Workiz importer writes attributes `Product` does not declare and, for
   * 10 items, a type BitCRM has no enum value for. Both must survive a read:
   * `update` writes only the fields it is given, so anything the mapper drops
   * is erased on the first edit from the UI.
   */
  describe('toProduct (imported rows)', () => {
    const importedRow = {
      PK: 'PRODUCT#prod-1',
      SK: 'METADATA',
      GSI1PK: 'CATEGORY#Uncategorized',
      GSI1SK: 'PRODUCT#prod-1',
      GSI2PK: 'TYPE#service',
      GSI2SK: 'PRODUCT#prod-1',
      id: 'prod-1',
      sku: 'WZ-10707',
      name: 'Trip charge',
      category: 'Uncategorized',
      type: 'service',
      costCompany: 0,
      costTech: 0,
      priceClient: -35,
      serialTracking: false,
      minimumStockLevel: 0,
      status: 'active',
      createdAt: '2021-03-04T00:00:00.000Z',
      updatedAt: '2021-03-04T00:00:00.000Z',
      externalId: 'workiz:item:10707',
      taxable: true,
      manageStock: false,
      customAttributes: { 'In Store Location': 'Shelf 3' },
      workizFileId: '33144326',
    };

    const read = async (over: Record<string, unknown> = {}) => {
      dynamoDb.client.send.mockResolvedValue({ Item: { ...importedRow, ...over } });
      return (await repository.findById('prod-1')) as unknown as Record<string, unknown>;
    };

    it('carries the importer attributes onto the entity', async () => {
      const product = await read();

      expect(product).toMatchObject({
        externalId: 'workiz:item:10707',
        taxable: true,
        manageStock: false,
        workizFileId: '33144326',
        customAttributes: { 'In Store Location': 'Shelf 3' },
      });
    });

    it('never leaks the DynamoDB key attributes', async () => {
      const product = await read();

      for (const key of ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK']) {
        expect(product[key]).toBeUndefined();
      }
    });

    /**
     * The whole commit rests on `toProduct` spreading the stored row FIRST and
     * writing the typed fields over it. That order is only observable where
     * the typed read path produces something different from what is stored —
     * `type` is that place (an unknown word is normalised to `service`). If
     * `...extras` were spread last, or the typed fields moved above it, the
     * raw `other` would win here and every `assertStockable` / TypeIndex
     * consumer would see a value `ProductType` has no member for.
     */
    it('lets the typed fields win over the colliding stored value', async () => {
      const product = await read({
        type: 'other',
        taxable: 'yes-from-workiz',
        nonDiscountable: 'yes-from-workiz',
      });

      // Typed field beats the stored one it collides with…
      expect(product.type).toBe('service');
      expect(product.type).not.toBe('other');
      // …while an attribute with no typed counterpart is still carried through
      // (so the fix is the order, not dropping the spread).
      expect(product.nonDiscountable).toBe('yes-from-workiz');
      expect(product.workizType).toBe('other');
      // `taxable` is typed since billing: anything but an explicit false reads as taxable.
      expect(product.taxable).toBe(true);
    });

    it("maps a Workiz 'other' type to service and keeps the word", async () => {
      const product = await read({ type: 'other' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('other');
    });

    it("maps a Workiz 'hours' type to service and keeps the word", async () => {
      const product = await read({ type: 'hours' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('hours');
    });

    it('prefers an explicit workizType the importer already wrote', async () => {
      const product = await read({ type: 'service', workizType: 'hours' });

      expect(product.type).toBe('service');
      expect(product.workizType).toBe('hours');
    });

    it('leaves workizType off a normal product', async () => {
      const product = await read({ type: 'product' });

      expect(product.type).toBe('product');
      expect('workizType' in product).toBe(false);
    });

    it('leaves a row with no type untyped so the boot backfill still heals it', async () => {
      const { type: _dropped, ...noType } = importedRow;
      dynamoDb.client.send.mockResolvedValue({ Item: noType });

      const product = await repository.findById('prod-1');

      expect(product!.type).toBeUndefined();
    });
  });

  /**
   * Скільки всього товарів — число для «Page 2 of 7».
   *
   * Той самий фільтр, що й у списку, але `Select: 'COUNT'`: тіла рядків не
   * їдуть по дроту. Прохід обмежений, бо таблиця інвентарю тримає не лише
   * товари, і розріджений Scan міг би читати її всю.
   */
  describe('countAll', () => {
    it('counts without pulling item bodies back', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 42, LastEvaluatedKey: undefined });

      const result = await repository.countAll();

      expect(result).toEqual({ total: 42, atLeast: false });
      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.Select).toBe('COUNT');
    });

    it('counts under the same filter the list uses', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      await repository.countAll({ status: 'active', search: ' Lock ' });

      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.FilterExpression).toContain('#status = :status');
      expect(sent.input.FilterExpression).toContain('contains(searchName, :search)');
      expect(sent.input.ExpressionAttributeValues[':status']).toBe('active');
      expect(sent.input.ExpressionAttributeValues[':search']).toBe('lock');
    });

    it('sums across the walk', async () => {
      dynamoDb.client.send
        .mockResolvedValueOnce({ Count: 20, LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Count: 20, LastEvaluatedKey: { PK: 'X#2', SK: 'METADATA' } })
        .mockResolvedValueOnce({ Count: 7 });

      expect(await repository.countAll()).toEqual({ total: 47, atLeast: false });
    });

    // Розріджена таблиця не має права коштувати сторінці повного проходу.
    it('gives up on an exact answer rather than walk the whole table', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Count: 1,
        LastEvaluatedKey: { PK: 'X#1', SK: 'METADATA' },
      });

      const result = await repository.countAll();

      expect(result.atLeast).toBe(true);
      expect(dynamoDb.client.send.mock.calls.length).toBeLessThanOrEqual(20);
    });
  });

  /**
   * Категорія і тип — це Query по індексу з постійним ключем, тому їхній
   * лічильник дешевий: жодного Scan, самі ключі.
   */
  describe('countByCategory / countByType', () => {
    it('counts a category on the category index', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 9 });

      expect(await repository.countByCategory('locks')).toEqual({ total: 9, atLeast: false });
      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.Select).toBe('COUNT');
      expect(sent.input.ExpressionAttributeValues[':pk']).toBe('CATEGORY#locks');
    });

    it('counts a type on the type index', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 4 });

      expect(await repository.countByType('part')).toEqual({ total: 4, atLeast: false });
      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.Select).toBe('COUNT');
      expect(sent.input.ExpressionAttributeValues[':pk']).toBe('TYPE#part');
    });
  });

  /**
   * Короткий послідовний номер товару — "Product ID" у Workiz. Лічильник
   * живе в рядку COUNTER#PRODUCT / METADATA і росте атомарним ADD, тож два
   * паралельні create ніколи не отримають один номер.
   */
  describe('nextNumber / raiseCounterTo', () => {
    it('increments the counter row atomically and returns the new value', async () => {
      dynamoDb.client.send.mockResolvedValue({ Attributes: { seq: 42 } });

      expect(await repository.nextNumber()).toBe(42);
      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.Key).toEqual({ PK: 'COUNTER#PRODUCT', SK: 'METADATA' });
      expect(sent.input.UpdateExpression).toBe('ADD #seq :one');
      expect(sent.input.ExpressionAttributeNames).toEqual({ '#seq': 'seq' });
      expect(sent.input.ExpressionAttributeValues).toEqual({ ':one': 1 });
      expect(sent.input.ReturnValues).toBe('ALL_NEW');
    });

    it('raises the counter only when the stored value is lower or absent', async () => {
      dynamoDb.client.send.mockResolvedValue({});

      await repository.raiseCounterTo(10707);

      const sent = dynamoDb.client.send.mock.calls[0][0];
      expect(sent.input.Key).toEqual({ PK: 'COUNTER#PRODUCT', SK: 'METADATA' });
      expect(sent.input.UpdateExpression).toBe('SET #seq = :n');
      expect(sent.input.ConditionExpression).toBe('attribute_not_exists(#seq) OR #seq < :n');
      expect(sent.input.ExpressionAttributeNames).toEqual({ '#seq': 'seq' });
      expect(sent.input.ExpressionAttributeValues).toEqual({ ':n': 10707 });
    });

    it('treats a higher stored counter as already done', async () => {
      const error = new Error('Condition not met');
      error.name = 'ConditionalCheckFailedException';
      dynamoDb.client.send.mockRejectedValue(error);

      await expect(repository.raiseCounterTo(5)).resolves.toBeUndefined();
    });

    it('rethrows anything but the condition failure', async () => {
      dynamoDb.client.send.mockRejectedValue(new Error('Network error'));

      await expect(repository.raiseCounterTo(5)).rejects.toThrow('Network error');
    });
  });

  describe('toProduct (stock fields)', () => {
    it('reads number, manageStock, brandId, reorderLevel and onHand as typed fields', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: {
          ...createMockProduct(),
          PK: 'PRODUCT#prod-1',
          SK: 'METADATA',
          number: 10707,
          manageStock: false,
          brandId: 'brand-1',
          reorderLevel: 3,
          onHand: 17,
        },
      });

      const product = await repository.findById('prod-1');

      expect(product).toMatchObject({
        number: 10707,
        manageStock: false,
        brandId: 'brand-1',
        reorderLevel: 3,
        onHand: 17,
      });
    });

    it('leaves them undefined on a row that has none', async () => {
      dynamoDb.client.send.mockResolvedValue({
        Item: { ...createMockProduct(), PK: 'PRODUCT#prod-1', SK: 'METADATA' },
      });

      const product = (await repository.findById('prod-1'))!;

      expect(product.number).toBeUndefined();
      expect(product.manageStock).toBeUndefined();
      expect(product.brandId).toBeUndefined();
      expect(product.reorderLevel).toBeUndefined();
      expect(product.onHand).toBeUndefined();
    });
  });

  /**
   * У Workiz фільтри списку складаються: категорія І статус І пошук І бренд І
   * "керується запасом". Індекс обирає категорія або тип, решта — FilterExpression
   * поверх нього; без решти Query лишається одиничним і нефільтрованим.
   */
  describe('list filters — combinable', () => {
    const row = {
      ...createMockProduct(),
      PK: 'PRODUCT#prod-1',
      SK: 'METADATA',
      GSI1PK: 'CATEGORY#Locks',
      GSI1SK: 'PRODUCT#prod-1',
      GSI2PK: 'TYPE#product',
      GSI2SK: 'PRODUCT#prod-1',
    };
    const sentInput = () => dynamoDb.client.send.mock.calls[0][0].input;

    it('category + status: Query on CategoryIndex with a status filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      const result = await repository.findByCategory('Locks', 20, undefined, { status: 'active' });

      expect(result.items).toHaveLength(1);
      const input = sentInput();
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('CATEGORY#Locks');
      expect(input.FilterExpression).toBe('#status = :status');
      expect(input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
      expect(input.ExpressionAttributeValues[':status']).toBe('active');
    });

    it('a filtered index Query fills the page and its cursor carries the index keys', async () => {
      const rows = ['p1', 'p2', 'p3'].map((id) => ({
        ...row,
        id,
        PK: `PRODUCT#${id}`,
        GSI1SK: `PRODUCT#${id}`,
        GSI2SK: `PRODUCT#${id}`,
      }));
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: rows,
        LastEvaluatedKey: { PK: 'X#9', SK: 'METADATA' },
      });

      const result = await repository.findByCategory('Locks', 2, undefined, { status: 'active' });

      expect(result.items.map((p) => p.id)).toEqual(['p1', 'p2']);
      expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString())).toEqual({
        PK: 'PRODUCT#p2',
        SK: 'METADATA',
        GSI1PK: 'CATEGORY#Locks',
        GSI1SK: 'PRODUCT#p2',
      });
    });

    // Термін і збережені назва/SKU — у нижньому регістрі з обох боків, як у
    // складів, контейнерів і журналу: одне поле пошуку поводиться однаково на
    // кожній вкладці.
    it('type + search: Query on TypeIndex with the case-insensitive name/sku filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByType('product', 20, undefined, { search: ' Lock' });

      const input = sentInput();
      expect(input.IndexName).toBe('TypeIndex');
      expect(input.KeyConditionExpression).toBe('GSI2PK = :pk');
      expect(input.ExpressionAttributeValues[':pk']).toBe('TYPE#product');
      expect(input.FilterExpression).toBe('(contains(searchName, :search) OR contains(searchSku, :search))');
      expect(input.ExpressionAttributeNames).toBeUndefined();
      expect(input.ExpressionAttributeValues[':search']).toBe('lock');
    });

    it('a blank search term is no filter at all', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByType('product', 20, undefined, { search: '   ' });

      expect(sentInput().FilterExpression).toBeUndefined();
    });

    it('a type Query cursor carries the TypeIndex keys', async () => {
      const rows = ['p1', 'p2'].map((id) => ({
        ...row,
        id,
        PK: `PRODUCT#${id}`,
        GSI1SK: `PRODUCT#${id}`,
        GSI2SK: `PRODUCT#${id}`,
      }));
      dynamoDb.client.send.mockResolvedValueOnce({
        Items: rows,
        LastEvaluatedKey: { PK: 'X#9', SK: 'METADATA' },
      });

      const result = await repository.findByType('product', 1, undefined, { search: 'lock' });

      expect(JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString())).toEqual({
        PK: 'PRODUCT#p1',
        SK: 'METADATA',
        GSI2PK: 'TYPE#product',
        GSI2SK: 'PRODUCT#p1',
      });
    });

    // Workiz inv_product = товар, що керується запасом; послуги — ніколи.
    // Рядки BitCRM без прапорця вважаються керованими.
    it('manageStock=true: product-type rows whose flag is absent or true', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findAll(20, undefined, { manageStock: true });

      const input = sentInput();
      expect(input.IndexName).toBeUndefined();
      expect(input.FilterExpression).toBe(
        'begins_with(PK, :pk) AND SK = :sk AND ' +
          '#type = :productType AND (attribute_not_exists(manageStock) OR manageStock = :true)',
      );
      expect(input.ExpressionAttributeNames).toEqual({ '#type': 'type' });
      expect(input.ExpressionAttributeValues).toMatchObject({
        ':pk': 'PRODUCT#',
        ':sk': 'METADATA',
        ':productType': 'product',
        ':true': true,
      });
    });

    it('manageStock=false: rows whose flag is exactly false', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findAll(20, undefined, { manageStock: false });

      const input = sentInput();
      expect(input.FilterExpression).toBe(
        'begins_with(PK, :pk) AND SK = :sk AND manageStock = :false',
      );
      expect(input.ExpressionAttributeValues[':false']).toBe(false);
      expect(input.ExpressionAttributeNames).toBeUndefined();
    });

    // Категорія взяла індекс — тип іде фільтром, а не другим індексом.
    it('type rides along as a filter when the category index was chosen', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByCategory('Locks', 20, undefined, { type: 'service' });

      const input = sentInput();
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.FilterExpression).toBe('#type = :type');
      expect(input.ExpressionAttributeNames).toEqual({ '#type': 'type' });
      expect(input.ExpressionAttributeValues[':type']).toBe('service');
    });

    it('brandId filters on the brand', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findAll(20, undefined, { brandId: 'brand-1' });

      const input = sentInput();
      expect(input.FilterExpression).toBe(
        'begins_with(PK, :pk) AND SK = :sk AND brandId = :brandId',
      );
      expect(input.ExpressionAttributeValues[':brandId']).toBe('brand-1');
    });

    it('a plain category or type Query stays unfiltered and asks for exactly one page', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByCategory('Locks', 20);
      await repository.findByType('product', 20);

      for (const call of dynamoDb.client.send.mock.calls) {
        expect(call[0].input.FilterExpression).toBeUndefined();
        expect(call[0].input.Limit).toBe(20);
      }
    });

    it('an empty filter object is the same as none', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByCategory('Locks', 20, undefined, {
        status: undefined,
        search: undefined,
        brandId: undefined,
        manageStock: undefined,
      });

      expect(sentInput().FilterExpression).toBeUndefined();
    });

    it('every filter at once, joined with AND on the category index', async () => {
      dynamoDb.client.send.mockResolvedValue({ Items: [row] });

      await repository.findByCategory('Locks', 20, undefined, {
        status: 'active',
        search: 'lock',
        brandId: 'brand-1',
        manageStock: true,
      });

      const input = sentInput();
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.FilterExpression).toBe(
        '#status = :status AND ' +
          '(contains(searchName, :search) OR contains(searchSku, :search)) AND ' +
          'brandId = :brandId AND ' +
          '#type = :productType AND (attribute_not_exists(manageStock) OR manageStock = :true)',
      );
      expect(input.ExpressionAttributeNames).toEqual({
        '#status': 'status',
        '#type': 'type',
      });
    });
  });

  // Лічильник мусить дивитись на ту саму вибірку, що й список.
  describe('counts take the same filters as the list', () => {
    const sentInput = () => dynamoDb.client.send.mock.calls[0][0].input;

    it('countByCategory with a status filter', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 3 });

      expect(await repository.countByCategory('Locks', { status: 'active' })).toEqual({
        total: 3,
        atLeast: false,
      });
      const input = sentInput();
      expect(input.Select).toBe('COUNT');
      expect(input.IndexName).toBe('CategoryIndex');
      expect(input.FilterExpression).toBe('#status = :status');
      expect(input.ExpressionAttributeValues[':status']).toBe('active');
    });

    it('countByType with manageStock=false', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 2 });

      await repository.countByType('product', { manageStock: false });

      const input = sentInput();
      expect(input.IndexName).toBe('TypeIndex');
      expect(input.FilterExpression).toBe('manageStock = :false');
    });

    it('countAll with brandId + search', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 1 });

      await repository.countAll({ search: 'lock', brandId: 'brand-1' });

      const input = sentInput();
      expect(input.FilterExpression).toBe(
        'begins_with(PK, :pk) AND SK = :sk AND ' +
          '(contains(searchName, :search) OR contains(searchSku, :search)) AND brandId = :brandId',
      );
    });

    it('an unfiltered countByCategory stays a bare key count', async () => {
      dynamoDb.client.send.mockResolvedValue({ Count: 9 });

      await repository.countByCategory('Locks');

      expect(sentInput().FilterExpression).toBeUndefined();
    });
  });
});
