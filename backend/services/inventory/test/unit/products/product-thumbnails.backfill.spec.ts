import { runProductThumbnailBackfill } from 'src/products/product-thumbnails.backfill';

/**
 * backfill:product-thumbnails — мініатюра кожного фото, що вже лежить у S3.
 * Йде розділом Price Book на GSI4 (без Scan), бере лише рядки з фото,
 * ідемпотентний: рядок з мініатюрою поточного фото не чіпає.
 */
describe('runProductThumbnailBackfill', () => {
  const noThumb = { PK: 'PRODUCT#p1', id: 'p1', photoKey: 'products/p1/a.jpg' };
  const current = { PK: 'PRODUCT#p2', id: 'p2', photoKey: 'products/p2/b.png', thumbKey: 'products/p2/thumb-b.webp' };
  const replaced = { PK: 'PRODUCT#p3', id: 'p3', photoKey: 'products/p3/new.jpg', thumbKey: 'products/p3/thumb-old.webp' };
  const missing = { PK: 'PRODUCT#p4', id: 'p4', photoKey: 'products/p4/gone.jpg' };

  function setup(pages: unknown[][] = [[noThumb, current], [replaced, missing]]) {
    const send = jest.fn(async (command: any) => {
      if (command.constructor.name === 'QueryCommand') {
        const at = command.input.ExclusiveStartKey ? Number(command.input.ExclusiveStartKey.page) : 0;
        return {
          Items: pages[at],
          ...(at + 1 < pages.length ? { LastEvaluatedKey: { page: at + 1 } } : {}),
        };
      }
      return { Attributes: {} };
    });
    const s3 = {
      getObjectBuffer: jest.fn(async (key: string) => (key.includes('gone') ? null : { body: Buffer.from(key) })),
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const make = jest.fn(async (bytes: Buffer) => Buffer.concat([Buffer.from('thumb:'), bytes]));
    return { send, s3, make, deps: { send, s3, make, tableName: 'BitCRM_Inventory' } };
  }
  const writes = (send: jest.Mock) =>
    send.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === 'UpdateCommand');

  it('walks the Price Book partition page by page — never a Scan — keeping rows with a photo', async () => {
    const { send, deps } = setup();
    await runProductThumbnailBackfill(deps);

    const queries = send.mock.calls.map((c) => c[0]).filter((c) => c.constructor.name === 'QueryCommand');
    expect(queries).toHaveLength(2);
    expect(queries[0].input).toMatchObject({
      TableName: 'BitCRM_Inventory',
      IndexName: 'TransferEntityIndex',
      KeyConditionExpression: 'GSI4PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PRODUCTS#ALL' },
      FilterExpression: 'attribute_exists(photoKey)',
    });
    expect(queries[0].input.ProjectionExpression).toContain('photoKey');
    expect(queries[0].input.ProjectionExpression).toContain('thumbKey');
    expect(queries[1].input.ExclusiveStartKey).toEqual({ page: 1 });
    expect(send.mock.calls.some((c) => c[0].constructor.name === 'ScanCommand')).toBe(false);
  });

  it('makes the missing and the stale thumbnails, skips the current one, counts the lost photo', async () => {
    const { send, s3, deps } = setup();
    const result = await runProductThumbnailBackfill(deps);

    expect(result).toEqual({
      withPhoto: 4,
      current: 1,
      made: 2,
      pending: 0,
      missing: 1,
      unreadable: 0,
      stale: 0,
    });
    expect(s3.putObject.mock.calls.map((c) => c[0])).toEqual([
      'products/p1/thumb-a.webp',
      'products/p3/thumb-new.webp',
    ]);
    expect(writes(send).map((c) => c.input.Key.PK)).toEqual(['PRODUCT#p1', 'PRODUCT#p3']);
    expect(s3.getObjectBuffer).not.toHaveBeenCalledWith('products/p2/b.png');
  });

  it('is idempotent: a second run over made thumbnails writes nothing', async () => {
    const done = [
      { ...noThumb, thumbKey: 'products/p1/thumb-a.webp' },
      current,
    ];
    const { send, s3, deps } = setup([done]);
    const result = await runProductThumbnailBackfill(deps);
    expect(result).toMatchObject({ withPhoto: 2, current: 2, made: 0 });
    expect(writes(send)).toHaveLength(0);
    expect(s3.putObject).not.toHaveBeenCalled();
  });

  it('only counts in a dry run', async () => {
    const { send, s3, deps } = setup();
    const result = await runProductThumbnailBackfill(deps, { dryRun: true });
    expect(result).toMatchObject({ withPhoto: 4, current: 1, pending: 3, made: 0 });
    expect(s3.getObjectBuffer).not.toHaveBeenCalled();
    expect(writes(send)).toHaveLength(0);
  });

  it('stops after --max attempts', async () => {
    const { s3, deps } = setup();
    const result = await runProductThumbnailBackfill(deps, { max: 1 });
    expect(result.made).toBe(1);
    expect(s3.putObject).toHaveBeenCalledTimes(1);
  });

  it('remakes current thumbnails with --force', async () => {
    const { s3, deps } = setup([[current]]);
    const result = await runProductThumbnailBackfill(deps, { force: true });
    expect(result.made).toBe(1);
    expect(s3.putObject).toHaveBeenCalledWith('products/p2/thumb-b.webp', expect.any(Buffer), expect.anything());
  });

  it('stops on a failure it cannot explain — a rerun picks up where it left', async () => {
    const { s3, deps } = setup();
    s3.putObject.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(runProductThumbnailBackfill(deps)).rejects.toThrow('AccessDenied');
  });
});
