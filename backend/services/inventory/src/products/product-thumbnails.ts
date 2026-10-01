import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Sharp, SharpOptions } from 'sharp';
import { DynamoDbService, S3Service } from '@bitcrm/shared';
import type { Product } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';
import { ProductsService } from './products.service';
import { ProductsRepository } from './products.repository';
import { ProductsCacheService } from './products-cache.service';

/**
 * Item photo thumbnails — what the Items and Price Book tables show in a row.
 *
 * Workiz draws every item as a 40×40 picture beside its id, cut from a
 * 128×128 copy of the photo. The tables here do the same: a list row carries
 * `thumbnailUrl`, a presigned GET of a small webp, instead of the browser
 * pulling a full photo (hundreds of KB, some several MB) per row.
 *
 * Stored beside the photo: `products/<id>/<uuid>.jpg` → `products/<id>/thumb-<uuid>.webp`,
 * and the product row names it in `thumbKey`. A thumbnail belongs to the
 * photo its key is derived from — a row whose `thumbKey` is not the current
 * photo's (the photo was replaced, the thumbnail not made yet) has none.
 * Made by `POST /products/:id/photo/complete` after an upload, and for photos
 * already stored by `backfill:product-thumbnails`.
 */

/** Workiz's thumbnail edge (its URLs end `_128_128.png`), shown at 40 px — sharp on a 3× screen. */
export const THUMB_SIZE = 128;
export const THUMB_CONTENT_TYPE = 'image/webp';
const THUMB_QUALITY = 78;
/** A thumbnail's key names its photo, so its bytes never change — the browser may keep it. */
export const THUMB_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/** The row attributes a thumbnail is decided on. */
export interface ThumbnailRow {
  id: string;
  photoKey?: string;
  thumbKey?: string;
}

/** A product as a list answers it: its thumbnail's URL when it has a current one. */
export type ProductWithThumbnail<T extends Product = Product> = T & { thumbnailUrl?: string };

/** `products/p1/u1.jpg` → `products/p1/thumb-u1.webp`: beside the photo, named by it. */
export function thumbKeyFor(photoKey: string): string {
  const slash = photoKey.lastIndexOf('/');
  const dir = slash >= 0 ? photoKey.slice(0, slash + 1) : '';
  const file = photoKey.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  const base = dot > 0 ? file.slice(0, dot) : file;
  return `${dir}thumb-${base}.webp`;
}

/** The row's thumbnail key when it is the current photo's; else it has no thumbnail. */
export function currentThumbKey(row: { photoKey?: unknown; thumbKey?: unknown }): string | undefined {
  if (typeof row.photoKey !== 'string' || !row.photoKey) return undefined;
  if (typeof row.thumbKey !== 'string') return undefined;
  return row.thumbKey === thumbKeyFor(row.photoKey) ? row.thumbKey : undefined;
}

/**
 * When a list's thumbnail URLs are signed: at the top of the hour, valid for
 * two. The same key signs to the same URL all hour, so a list reloaded, paged
 * back or refetched on focus hits the browser's cache instead of S3.
 */
export function thumbnailSigning(now: Date = new Date()): { signingDate: Date; expiresIn: number } {
  const signingDate = new Date(now);
  signingDate.setUTCMinutes(0, 0, 0);
  return { signingDate, expiresIn: 2 * 60 * 60 };
}

type SharpFactory = (input?: Buffer, options?: SharpOptions) => Sharp;
let sharpLoad: Promise<SharpFactory> | null = null;

/**
 * sharp is a native module. It is loaded on the first thumbnail, not when the
 * service boots: an image without its binary answers this one route with a
 * 503 instead of taking every inventory route down with it.
 */
function loadSharp(): Promise<SharpFactory> {
  if (!sharpLoad) {
    sharpLoad = import('sharp')
      .then((mod) => {
        const sharp = ((mod as { default?: unknown }).default ?? mod) as SharpFactory & {
          cache: (on: boolean) => void;
          concurrency: (n: number) => void;
        };
        // A 0.25-vCPU task: one libvips thread, no decoded-image cache.
        sharp.cache(false);
        sharp.concurrency(1);
        return sharp;
      })
      .catch((err: unknown) => {
        sharpLoad = null;
        throw err;
      });
  }
  return sharpLoad;
}

/** The photo could not be decoded — not an image, or a format sharp can't read. */
export class UnreadableImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnreadableImageError';
  }
}

/** sharp's native binary is not there — the image was built without it. */
export class ThumbnailerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThumbnailerUnavailableError';
  }
}

/**
 * A square THUMB_SIZE webp of the photo: turned upright by its EXIF
 * orientation (phone photos), the centre cut to a square as Workiz's is
 * (`object-fit: cover` shows the same), never enlarged.
 */
export async function makeThumbnail(photo: Buffer): Promise<Buffer> {
  let sharp: SharpFactory;
  try {
    sharp = await loadSharp();
  } catch (err) {
    throw new ThumbnailerUnavailableError((err as Error).message);
  }
  try {
    return await sharp(photo, { failOn: 'error' })
      .rotate()
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();
  } catch (err) {
    throw new UnreadableImageError((err as Error).message);
  }
}

/** Anything that sends a document-client UpdateCommand — the client itself, or a test double. */
export type ThumbnailSend = (command: UpdateCommand) => Promise<any>;

/**
 * Names the thumbnail on the product row — only while the row still holds the
 * photo it was made from. A photo replaced mid-way wins: the write is refused
 * (`stale`) and the newer photo gets its own. Touches `thumbKey` alone — not
 * `updatedAt`, not the index keys: a thumbnail is derived, not an edit.
 */
export async function writeThumbKey(
  send: ThumbnailSend,
  tableName: string,
  row: { id: string; photoKey: string },
  thumbKey: string,
): Promise<{ outcome: 'written'; previous?: string } | { outcome: 'stale' }> {
  try {
    const result = await send(
      new UpdateCommand({
        TableName: tableName,
        Key: { PK: `PRODUCT#${row.id}`, SK: 'METADATA' },
        UpdateExpression: 'SET thumbKey = :thumb',
        ConditionExpression: 'attribute_exists(PK) AND photoKey = :photo',
        ExpressionAttributeValues: { ':thumb': thumbKey, ':photo': row.photoKey },
        ReturnValues: 'UPDATED_OLD',
      }),
    );
    const previous = result?.Attributes?.thumbKey as string | undefined;
    return { outcome: 'written', ...(previous && previous !== thumbKey ? { previous } : {}) };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      return { outcome: 'stale' };
    }
    throw error;
  }
}

/** What one thumbnail attempt came to. */
export type ThumbnailOutcome =
  /** Made, stored and named on the row. */
  | 'made'
  /** The row already names the current photo's thumbnail. */
  | 'current'
  /** The row has no photo. */
  | 'no-photo'
  /** The row names a photo S3 doesn't hold (an upload never finished). */
  | 'missing'
  /** The photo isn't an image sharp can read. */
  | 'unreadable'
  /** The photo was replaced while its thumbnail was being made. */
  | 'stale';

export interface ThumbnailDeps {
  s3: Pick<S3Service, 'getObjectBuffer' | 'putObject' | 'deleteObject'>;
  send: ThumbnailSend;
  tableName: string;
  /** Turns photo bytes into thumbnail bytes; `makeThumbnail` unless a test swaps it. */
  make?: (photo: Buffer) => Promise<Buffer>;
  onWarn?: (message: string) => void;
}

/**
 * One product's thumbnail, start to finish: read the photo, shrink it, store
 * it beside the photo, name it on the row, and drop the thumbnail of the
 * photo it replaced. Shared by the upload's "complete" step and the backfill,
 * so both make the same file under the same key. `force` remakes a current one.
 */
export async function ensureThumbnail(
  deps: ThumbnailDeps,
  row: ThumbnailRow,
  { force = false }: { force?: boolean } = {},
): Promise<{ outcome: ThumbnailOutcome; thumbKey?: string }> {
  const { photoKey } = row;
  if (!photoKey) return { outcome: 'no-photo' };
  const thumbKey = thumbKeyFor(photoKey);
  if (!force && currentThumbKey(row)) return { outcome: 'current', thumbKey };

  const photo = await deps.s3.getObjectBuffer(photoKey);
  if (!photo) return { outcome: 'missing' };

  let bytes: Buffer;
  try {
    bytes = await (deps.make ?? makeThumbnail)(photo.body);
  } catch (err) {
    if (err instanceof UnreadableImageError) {
      deps.onWarn?.(`Product ${row.id}: photo ${photoKey} is not a readable image (${err.message})`);
      return { outcome: 'unreadable' };
    }
    throw err;
  }

  await deps.s3.putObject(thumbKey, bytes, {
    contentType: THUMB_CONTENT_TYPE,
    cacheControl: THUMB_CACHE_CONTROL,
  });
  const written = await writeThumbKey(deps.send, deps.tableName, { id: row.id, photoKey }, thumbKey);
  if (written.outcome === 'stale') {
    // Its photo is gone from the row; so is this file's reason to exist.
    await deps.s3.deleteObject(thumbKey).catch(() => undefined);
    return { outcome: 'stale' };
  }
  if (written.previous) {
    await deps.s3.deleteObject(written.previous).catch((err: unknown) =>
      deps.onWarn?.(`Product ${row.id}: old thumbnail ${written.previous} not deleted (${(err as Error).message})`),
    );
  }
  return { outcome: 'made', thumbKey };
}

/**
 * The web's side of it: "complete" after an upload, the thumbnails a list
 * page carries, and removing the photo with its thumbnail. Lives beside
 * ProductsService rather than in it, and writes `thumbKey` itself.
 */
@Injectable()
export class ProductThumbnailsService {
  private readonly logger = new Logger(ProductThumbnailsService.name);
  /** Thumbnails made one at a time per task: sharp is CPU-bound and the task is small. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly products: ProductsService,
    private readonly repository: ProductsRepository,
    private readonly cache: ProductsCacheService,
    private readonly s3: S3Service,
    private readonly dynamoDb: DynamoDbService,
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The photo's bytes are in S3: make its thumbnail and name it on the item.
   * Answers the item with its `thumbnailUrl`. 409 while the photo isn't in S3
   * yet, 422 for a file that isn't a readable image (the photo itself stays).
   */
  async complete(id: string): Promise<ProductWithThumbnail> {
    const product = (await this.products.findById(id)) as Product & { thumbKey?: string };
    if (!product.photoKey) throw new NotFoundException('Product has no photo');

    let made: Awaited<ReturnType<typeof ensureThumbnail>>;
    try {
      made = await this.serial(() =>
        ensureThumbnail(
          {
            s3: this.s3,
            send: (command) => this.dynamoDb.client.send(command),
            tableName: INVENTORY_TABLE,
            onWarn: (message) => this.logger.warn(message),
          },
          product,
        ),
      );
    } catch (err) {
      if (err instanceof ThumbnailerUnavailableError) {
        this.logger.error(`sharp is not available: ${err.message}`);
        throw new ServiceUnavailableException('Thumbnails are not available on this server');
      }
      throw err;
    }

    switch (made.outcome) {
      case 'missing':
        throw new ConflictException('The photo has not been uploaded yet');
      case 'unreadable':
        throw new UnprocessableEntityException(
          'The photo is saved, but it is not an image a thumbnail can be made from',
        );
      case 'stale':
        throw new ConflictException('The photo was replaced while its thumbnail was being made');
      default:
        break;
    }

    await this.cache.invalidate(id);
    const fresh = (await this.products.findById(id)) as Product & { thumbKey?: string };
    const [withUrl] = await this.withThumbnails([fresh]);
    return withUrl;
  }

  /**
   * A list page's items, each with the URL of its thumbnail when it has a
   * current one. Signing is local (no S3 call) and dated at the top of the
   * hour, so the URLs — and the browser's cache — hold all hour. Never fails
   * the list: an item that can't be signed is simply without a picture.
   */
  async withThumbnails<T extends Product>(items: T[]): Promise<ProductWithThumbnail<T>[]> {
    const signing = thumbnailSigning();
    return Promise.all(
      items.map(async (item) => {
        const key = currentThumbKey(item as T & { thumbKey?: string });
        if (!key) return item;
        try {
          const thumbnailUrl = await this.s3.getPresignedDownloadUrl(key, signing);
          return { ...item, thumbnailUrl };
        } catch (err) {
          this.logger.warn(`Thumbnail of ${item.id} not signed: ${(err as Error).message}`);
          return item;
        }
      }),
    );
  }

  /** Removes the item's photo and its thumbnail — both files, both keys. */
  async removePhoto(id: string): Promise<Product> {
    const product = (await this.products.findById(id)) as Product & { thumbKey?: string };
    const files = [product.photoKey, product.thumbKey].filter((k): k is string => !!k);
    await Promise.all(
      files.map((key) =>
        this.s3.deleteObject(key).catch((err: unknown) =>
          this.logger.warn(`Failed to delete ${key} for ${id}: ${(err as Error).message}`),
        ),
      ),
    );
    const updated = await this.repository.update(id, {
      photoKey: undefined,
      thumbKey: undefined,
    } as Partial<Product>);
    await this.cache.invalidate(id);
    return updated;
  }
}
