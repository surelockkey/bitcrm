import { runCatalogIndexBackfill } from 'src/products/product-catalog-index.backfill';

const conditionFailed = () => {
  const error = new Error('The conditional request failed');
  error.name = 'ConditionalCheckFailedException';
  return error;
};

/**
 * backfill:product-catalog-index — кожен рядок товару на розділ Price Book.
 * Ідемпотентний: правильно підшитий рядок не чіпає; рядок, змінений після
 * Scan, пропускає (його підшила сама зміна), будь-яку іншу помилку не ковтає.
 */
describe('runCatalogIndexBackfill', () => {
  const needsFiling = { PK: 'PRODUCT#p-1', SK: 'METADATA', id: 'p-1', name: 'Lock' };
  const filed = { PK: 'PRODUCT#p-2', SK: 'METADATA', id: 'p-2', name: 'Key', GSI4PK: 'PRODUCTS#ALL', GSI4SK: 'key#p-2' };
  const renamed = {
    PK: 'PRODUCT#p-3',
    SK: 'METADATA',
    id: 'p-3',
    name: 'Door Chain',
    GSI4PK: 'PRODUCTS#ALL',
    GSI4SK: 'chain guard#p-3',
  };

  const twoPages = (onUpdate: (input: any) => unknown = () => ({})) =>
    jest.fn(async (command: any) => {
      if (command.constructor.name === 'ScanCommand') {
        return command.input.ExclusiveStartKey
          ? { Items: [renamed] }
          : { Items: [needsFiling, filed], LastEvaluatedKey: { PK: 'PRODUCT#p-2', SK: 'METADATA' } };
      }
      return onUpdate(command.input);
    });

  it('scans every page of product rows and files the ones that need it', async () => {
    const send = twoPages();

    const result = await runCatalogIndexBackfill(send, 'BitCRM_Inventory');

    expect(result).toEqual({ scanned: 3, filed: 2, alreadyFiled: 1, skipped: 0 });
    const updates = send.mock.calls.map((call) => call[0]).filter((c) => c.constructor.name === 'UpdateCommand');
    expect(updates.map((c) => [c.input.TableName, c.input.Key.PK, c.input.ExpressionAttributeValues[':catalogSk']])).toEqual([
      ['BitCRM_Inventory', 'PRODUCT#p-1', 'lock#p-1'],
      ['BitCRM_Inventory', 'PRODUCT#p-3', 'door chain#p-3'],
    ]);
    expect(updates[1].input.ConditionExpression).toContain('GSI4SK = :seenCatalogSk');
  });

  it('reads only product metadata, and only the attributes the decision needs', async () => {
    const send = twoPages();

    await runCatalogIndexBackfill(send, 'BitCRM_Inventory');

    const scan = send.mock.calls[0][0].input;
    expect(scan).toMatchObject({
      TableName: 'BitCRM_Inventory',
      FilterExpression: 'begins_with(PK, :product) AND SK = :meta',
      ExpressionAttributeValues: { ':product': 'PRODUCT#', ':meta': 'METADATA' },
      ProjectionExpression: 'PK, SK, id, #name, GSI4PK, GSI4SK',
      ExpressionAttributeNames: { '#name': 'name' },
    });
    expect(send.mock.calls[send.mock.calls.length - 1][0].constructor.name).not.toBe('ScanCommand');
    const secondScan = send.mock.calls.map((call) => call[0]).filter((c) => c.constructor.name === 'ScanCommand')[1];
    expect(secondScan.input.ExclusiveStartKey).toEqual({ PK: 'PRODUCT#p-2', SK: 'METADATA' });
  });

  it('skips a row that changed since the scan, names it, and goes on', async () => {
    const skippedRows: string[] = [];
    const send = twoPages((input) => {
      if (input.Key.PK === 'PRODUCT#p-1') throw conditionFailed();
      return {};
    });

    const result = await runCatalogIndexBackfill(send, 'T', { onSkip: (pk) => skippedRows.push(pk) });

    expect(result).toEqual({ scanned: 3, filed: 1, alreadyFiled: 1, skipped: 1 });
    expect(skippedRows).toEqual(['PRODUCT#p-1']);
  });

  it('stops on any other failure', async () => {
    const send = twoPages(() => {
      throw new Error('ProvisionedThroughputExceededException');
    });

    await expect(runCatalogIndexBackfill(send, 'T')).rejects.toThrow('ProvisionedThroughputExceededException');
  });

  it('files nothing on a table that is already filed', async () => {
    const send = jest.fn(async () => ({ Items: [filed] }));

    expect(await runCatalogIndexBackfill(send, 'T')).toEqual({ scanned: 1, filed: 0, alreadyFiled: 1, skipped: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
