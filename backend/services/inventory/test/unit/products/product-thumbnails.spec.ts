import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import sharp from 'sharp';
import {
  THUMB_CACHE_CONTROL,
  THUMB_SIZE,
  ProductThumbnailsService,
  UnreadableImageError,
  currentThumbKey,
  ensureThumbnail,
  makeThumbnail,
  thumbKeyFor,
  thumbnailSigning,
  writeThumbKey,
  type ThumbnailDeps,
} from 'src/products/product-thumbnails';
import { createMockProduct } from '../mocks';

/** A real picture, so the thumbnail is made by sharp itself, not a double. */
function photo(width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    [format]()
    .toBuffer();
}

const conditionFailed = () =>
  Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

describe('thumbKeyFor', () => {
  it('puts the thumbnail beside its photo, named by it', () => {
    expect(thumbKeyFor('products/p1/0b7c.jpg')).toBe('products/p1/thumb-0b7c.webp');
    expect(thumbKeyFor('products/p1/0b7c.png')).toBe('products/p1/thumb-0b7c.webp');
  });

  it('copes with a key without a folder or an extension', () => {
    expect(thumbKeyFor('photo.jpg')).toBe('thumb-photo.webp');
    expect(thumbKeyFor('products/p1/raw')).toBe('products/p1/thumb-raw.webp');
  });
});

describe('currentThumbKey', () => {
  it("is the row's thumbnail when it was made from the current photo", () => {
    expect(currentThumbKey({ photoKey: 'products/p1/a.jpg', thumbKey: 'products/p1/thumb-a.webp' })).toBe(
      'products/p1/thumb-a.webp',
    );
  });

  // Replaced: the presign wrote the new photoKey; the old thumbnail is not this photo's.
  it('is none when the photo was replaced after the thumbnail was made', () => {
    expect(currentThumbKey({ photoKey: 'products/p1/b.jpg', thumbKey: 'products/p1/thumb-a.webp' })).toBeUndefined();
  });

  it('is none without a photo or without a thumbnail', () => {
    expect(currentThumbKey({ thumbKey: 'products/p1/thumb-a.webp' })).toBeUndefined();
    expect(currentThumbKey({ photoKey: 'products/p1/a.jpg' })).toBeUndefined();
  });
});

describe('thumbnailSigning', () => {
  it('signs at the top of the hour, valid for two, so a URL holds all hour', () => {
    const at = thumbnailSigning(new Date('2026-09-30T14:37:12.345Z'));
    expect(at.signingDate.toISOString()).toBe('2026-09-30T14:00:00.000Z');
    expect(at.expiresIn).toBe(7200);
    expect(thumbnailSigning(new Date('2026-09-30T14:59:59.999Z')).signingDate).toEqual(at.signingDate);
  });
});

describe('makeThumbnail', () => {
  it('makes a square webp of Workiz size from a wide photo', async () => {
    const out = await makeThumbnail(await photo(800, 500, 'jpeg'));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('webp');
    expect([meta.width, meta.height]).toEqual([THUMB_SIZE, THUMB_SIZE]);
    expect(out.byteLength).toBeLessThan(10_000);
  });

  it('never enlarges a photo smaller than the thumbnail', async () => {
    const meta = await sharp(await makeThumbnail(await photo(60, 40))).metadata();
    expect(meta.width).toBeLessThanOrEqual(60);
    expect(meta.height).toBeLessThanOrEqual(40);
  });

  // A phone photo stored sideways with an EXIF "rotate 90°" tag comes out upright:
  // stored red-left / blue-right, it shows red on top, blue below.
  it('turns the photo upright by its EXIF orientation', async () => {
    const half = (color: string) =>
      sharp({ create: { width: 300, height: 200, channels: 3, background: color } }).png().toBuffer();
    const sideways = await sharp({ create: { width: 600, height: 200, channels: 3, background: '#000' } })
      .composite([
        { input: await half('#ff0000'), left: 0, top: 0 },
        { input: await half('#0000ff'), left: 300, top: 0 },
      ])
      .jpeg()
      .toBuffer();
    const tagged = await sharp(sideways).withMetadata({ orientation: 6 }).jpeg().toBuffer();

    const { data, info } = await sharp(await makeThumbnail(tagged)).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const [topR, , topB] = at(64, 5);
    const [bottomR, , bottomB] = at(64, info.height - 6);
    expect(topR).toBeGreaterThan(200);
    expect(topB).toBeLessThan(60);
    expect(bottomB).toBeGreaterThan(200);
    expect(bottomR).toBeLessThan(60);
  });

  it('refuses bytes that are not an image', async () => {
    await expect(makeThumbnail(Buffer.from('not a picture'))).rejects.toBeInstanceOf(UnreadableImageError);
  });
});

describe('writeThumbKey', () => {
  it('names the thumbnail only while the row still holds that photo, and nothing else', async () => {
    const send = jest.fn().mockResolvedValue({ Attributes: {} });
    const out = await writeThumbKey(send, 'T', { id: 'p1', photoKey: 'products/p1/a.jpg' }, 'products/p1/thumb-a.webp');
    expect(out).toEqual({ outcome: 'written' });
    const input = send.mock.calls[0][0].input;
    expect(input.Key).toEqual({ PK: 'PRODUCT#p1', SK: 'METADATA' });
    expect(input.UpdateExpression).toBe('SET thumbKey = :thumb');
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND photoKey = :photo');
    expect(input.ExpressionAttributeValues).toEqual({
      ':thumb': 'products/p1/thumb-a.webp',
      ':photo': 'products/p1/a.jpg',
    });
  });

  it('hands back the thumbnail it replaced', async () => {
    const send = jest.fn().mockResolvedValue({ Attributes: { thumbKey: 'products/p1/thumb-old.webp' } });
    await expect(
      writeThumbKey(send, 'T', { id: 'p1', photoKey: 'products/p1/a.jpg' }, 'products/p1/thumb-a.webp'),
    ).resolves.toEqual({ outcome: 'written', previous: 'products/p1/thumb-old.webp' });
  });

  it('is stale when the photo was replaced meanwhile', async () => {
    const send = jest.fn().mockRejectedValue(conditionFailed());
    await expect(
      writeThumbKey(send, 'T', { id: 'p1', photoKey: 'products/p1/a.jpg' }, 'products/p1/thumb-a.webp'),
    ).resolves.toEqual({ outcome: 'stale' });
  });

  it('lets any other failure through', async () => {
    const send = jest.fn().mockRejectedValue(new Error('throttled'));
    await expect(
      writeThumbKey(send, 'T', { id: 'p1', photoKey: 'products/p1/a.jpg' }, 'products/p1/thumb-a.webp'),
    ).rejects.toThrow('throttled');
  });
});

describe('ensureThumbnail', () => {
  function deps(over: Partial<ThumbnailDeps> = {}) {
    const s3 = {
      getObjectBuffer: jest.fn().mockResolvedValue({ body: Buffer.from('jpg'), contentType: 'image/jpeg' }),
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    const send = jest.fn().mockResolvedValue({ Attributes: {} });
    const make = jest.fn().mockResolvedValue(Buffer.from('webp'));
    return { s3, send, make, tableName: 'T', ...over } as ThumbnailDeps & {
      s3: typeof s3;
      send: jest.Mock;
      make: jest.Mock;
    };
  }
  const row = { id: 'p1', photoKey: 'products/p1/a.jpg' };

  it('reads the photo, stores the webp beside it for a year of caching, and names it', async () => {
    const d = deps();
    await expect(ensureThumbnail(d, row)).resolves.toEqual({
      outcome: 'made',
      thumbKey: 'products/p1/thumb-a.webp',
    });
    expect(d.s3.getObjectBuffer).toHaveBeenCalledWith('products/p1/a.jpg');
    expect(d.make).toHaveBeenCalledWith(Buffer.from('jpg'));
    expect(d.s3.putObject).toHaveBeenCalledWith('products/p1/thumb-a.webp', Buffer.from('webp'), {
      contentType: 'image/webp',
      cacheControl: THUMB_CACHE_CONTROL,
    });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it('skips a row whose thumbnail is already current — unless forced', async () => {
    const d = deps();
    const done = { ...row, thumbKey: 'products/p1/thumb-a.webp' };
    await expect(ensureThumbnail(d, done)).resolves.toMatchObject({ outcome: 'current' });
    expect(d.s3.getObjectBuffer).not.toHaveBeenCalled();
    await expect(ensureThumbnail(d, done, { force: true })).resolves.toMatchObject({ outcome: 'made' });
  });

  it('remakes the thumbnail of a replaced photo and deletes the old file', async () => {
    const d = deps({ send: jest.fn().mockResolvedValue({ Attributes: { thumbKey: 'products/p1/thumb-old.webp' } }) });
    await ensureThumbnail(d, { ...row, thumbKey: 'products/p1/thumb-old.webp' });
    expect(d.s3.deleteObject).toHaveBeenCalledWith('products/p1/thumb-old.webp');
  });

  it('reports a photo S3 does not hold, writing nothing', async () => {
    const d = deps();
    d.s3.getObjectBuffer.mockResolvedValue(null);
    await expect(ensureThumbnail(d, row)).resolves.toEqual({ outcome: 'missing' });
    expect(d.s3.putObject).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });

  it('reports a file that is not an image, writing nothing', async () => {
    const onWarn = jest.fn();
    const d = deps({ make: jest.fn().mockRejectedValue(new UnreadableImageError('bad')), onWarn });
    await expect(ensureThumbnail(d, row)).resolves.toEqual({ outcome: 'unreadable' });
    expect(d.s3.putObject).not.toHaveBeenCalled();
    expect(onWarn).toHaveBeenCalledWith(expect.stringContaining('p1'));
  });

  it('drops the file it made when the photo was replaced meanwhile', async () => {
    const d = deps({ send: jest.fn().mockRejectedValue(conditionFailed()) });
    await expect(ensureThumbnail(d, row)).resolves.toEqual({ outcome: 'stale' });
    expect(d.s3.deleteObject).toHaveBeenCalledWith('products/p1/thumb-a.webp');
  });

  it('has nothing to do without a photo', async () => {
    const d = deps();
    await expect(ensureThumbnail(d, { id: 'p1' })).resolves.toEqual({ outcome: 'no-photo' });
    expect(d.s3.getObjectBuffer).not.toHaveBeenCalled();
  });
});

describe('ProductThumbnailsService', () => {
  let products: { findById: jest.Mock };
  let repository: { update: jest.Mock };
  let cache: { invalidate: jest.Mock };
  let s3: {
    getObjectBuffer: jest.Mock;
    putObject: jest.Mock;
    deleteObject: jest.Mock;
    getPresignedDownloadUrl: jest.Mock;
  };
  let send: jest.Mock;
  let service: ProductThumbnailsService;

  beforeEach(async () => {
    products = { findById: jest.fn() };
    repository = { update: jest.fn() };
    cache = { invalidate: jest.fn().mockResolvedValue(undefined) };
    s3 = {
      getObjectBuffer: jest.fn().mockResolvedValue({ body: await photo(300, 200) }),
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
      getPresignedDownloadUrl: jest.fn(async (key: string) => `https://s3.test/${key}?sig`),
    };
    send = jest.fn().mockResolvedValue({ Attributes: {} });
    service = new ProductThumbnailsService(
      products as any,
      repository as any,
      cache as any,
      s3 as any,
      { client: { send } } as any,
    );
  });

  describe('complete', () => {
    it('makes the thumbnail and answers the item with its URL', async () => {
      const before = createMockProduct({ photoKey: 'products/prod-1/a.jpg' });
      const after = { ...before, thumbKey: 'products/prod-1/thumb-a.webp' };
      products.findById.mockResolvedValueOnce(before).mockResolvedValueOnce(after);

      const out = await service.complete('prod-1');

      expect(s3.putObject).toHaveBeenCalledWith(
        'products/prod-1/thumb-a.webp',
        expect.any(Buffer),
        expect.objectContaining({ contentType: 'image/webp' }),
      );
      expect(cache.invalidate).toHaveBeenCalledWith('prod-1');
      expect(out.thumbnailUrl).toBe('https://s3.test/products/prod-1/thumb-a.webp?sig');
    });

    it('is a 404 for an item without a photo', async () => {
      products.findById.mockResolvedValue(createMockProduct());
      await expect(service.complete('prod-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 409 while the photo is not in S3 yet', async () => {
      products.findById.mockResolvedValue(createMockProduct({ photoKey: 'products/prod-1/a.jpg' }));
      s3.getObjectBuffer.mockResolvedValue(null);
      await expect(service.complete('prod-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('is a 422 for a file that is not an image — and keeps the photo', async () => {
      products.findById.mockResolvedValue(createMockProduct({ photoKey: 'products/prod-1/a.jpg' }));
      s3.getObjectBuffer.mockResolvedValue({ body: Buffer.from('%PDF-1.4') });
      await expect(service.complete('prod-1')).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(s3.deleteObject).not.toHaveBeenCalled();
      expect(repository.update).not.toHaveBeenCalled();
    });
  });

  describe('withThumbnails', () => {
    it('signs the current thumbnails only, at the top of the hour', async () => {
      const items = [
        createMockProduct({ id: 'a', photoKey: 'products/a/1.jpg', thumbKey: 'products/a/thumb-1.webp' } as any),
        // The photo was replaced; its thumbnail isn't made yet.
        createMockProduct({ id: 'b', photoKey: 'products/b/2.jpg', thumbKey: 'products/b/thumb-1.webp' } as any),
        createMockProduct({ id: 'c' }),
      ];
      const out = await service.withThumbnails(items);
      expect(out.map((p) => p.thumbnailUrl)).toEqual([
        'https://s3.test/products/a/thumb-1.webp?sig',
        undefined,
        undefined,
      ]);
      expect(s3.getPresignedDownloadUrl).toHaveBeenCalledTimes(1);
      const [, opts] = s3.getPresignedDownloadUrl.mock.calls[0];
      expect(opts.signingDate.getUTCMinutes()).toBe(0);
      expect(opts.signingDate.getUTCSeconds()).toBe(0);
      expect(opts.expiresIn).toBe(7200);
    });

    it('never fails the list over a URL it could not sign', async () => {
      s3.getPresignedDownloadUrl.mockRejectedValue(new Error('no credentials'));
      const item = createMockProduct({ photoKey: 'products/a/1.jpg', thumbKey: 'products/a/thumb-1.webp' } as any);
      await expect(service.withThumbnails([item])).resolves.toEqual([item]);
    });
  });

  describe('removePhoto', () => {
    it('deletes the photo and its thumbnail and clears both keys', async () => {
      products.findById.mockResolvedValue(
        createMockProduct({ photoKey: 'products/prod-1/a.jpg', thumbKey: 'products/prod-1/thumb-a.webp' } as any),
      );
      repository.update.mockResolvedValue(createMockProduct());
      await service.removePhoto('prod-1');
      expect(s3.deleteObject).toHaveBeenCalledWith('products/prod-1/a.jpg');
      expect(s3.deleteObject).toHaveBeenCalledWith('products/prod-1/thumb-a.webp');
      const attrs = repository.update.mock.calls[0][1];
      expect(Object.keys(attrs).sort()).toEqual(['photoKey', 'thumbKey']);
      expect(attrs.photoKey).toBeUndefined();
      expect(attrs.thumbKey).toBeUndefined();
      expect(cache.invalidate).toHaveBeenCalledWith('prod-1');
    });
  });
});
