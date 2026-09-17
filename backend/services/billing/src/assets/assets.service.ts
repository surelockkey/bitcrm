import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { S3Service } from '@bitcrm/shared';
import type { BillingAsset, JwtUser } from '@bitcrm/types';
import { assetS3Key } from '../common/constants/dynamo.constants';
import { documentsKmsKeyId } from '../common/constants/services.constants';
import { AssetsRepository } from './assets.repository';

export const ALLOWED_ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
const DATA_URI_CACHE_SIZE = 50;

export interface RequestAssetUpload {
  contentType: string;
  fileName?: string;
  size?: number;
}

/**
 * Template images (and the business logo). Uploaded by the browser straight
 * to S3 with a presigned SSE-KMS PUT, like deal attachments; inlined into
 * PDFs as data URIs because the PDF browser has no network.
 */
@Injectable()
export class AssetsService {
  private readonly logger = new Logger(AssetsService.name);
  /** Assets are immutable (a new upload is a new id), so this never goes stale. */
  private readonly dataUris = new Map<string, string>();

  constructor(
    private readonly repo: AssetsRepository,
    private readonly s3: S3Service,
  ) {}

  async requestUpload(
    dto: RequestAssetUpload,
    user: JwtUser,
  ): Promise<{ id: string; uploadUrl: string; headers: Record<string, string> }> {
    if (!(ALLOWED_ASSET_TYPES as readonly string[]).includes(dto.contentType)) {
      throw new BadRequestException(`Unsupported image type; use ${ALLOWED_ASSET_TYPES.join(', ')}`);
    }
    if (dto.size !== undefined && (dto.size <= 0 || dto.size > MAX_ASSET_BYTES)) {
      throw new BadRequestException('Images must be at most 5 MB');
    }
    const id = randomUUID();
    const { url, headers } = await this.s3.getPresignedUpload(assetS3Key(id), {
      contentType: dto.contentType,
      kmsKeyId: documentsKmsKeyId(),
    });
    const asset: BillingAsset = {
      id,
      contentType: dto.contentType,
      ...(dto.fileName && { fileName: dto.fileName }),
      ...(dto.size !== undefined && { size: dto.size }),
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    await this.repo.create(asset);
    return { id, uploadUrl: url, headers };
  }

  async getUrl(id: string): Promise<{ url: string }> {
    const asset = await this.repo.get(id);
    if (!asset) throw new NotFoundException('Asset not found');
    return { url: await this.s3.getPresignedDownloadUrl(assetS3Key(id), 3600) };
  }

  /** `data:` URI of an asset, or undefined when it is missing/unreadable. */
  async getDataUri(id: string): Promise<string | undefined> {
    const hit = this.dataUris.get(id);
    if (hit) return hit;
    try {
      const asset = await this.repo.get(id);
      if (!asset) return undefined;
      const obj = await this.s3.getObjectBuffer(assetS3Key(id));
      if (!obj || obj.body.byteLength > MAX_ASSET_BYTES) return undefined;
      const uri = `data:${asset.contentType};base64,${obj.body.toString('base64')}`;
      if (this.dataUris.size >= DATA_URI_CACHE_SIZE) {
        this.dataUris.delete(this.dataUris.keys().next().value as string);
      }
      this.dataUris.set(id, uri);
      return uri;
    } catch (err) {
      this.logger.warn(`asset ${id} unreadable: ${(err as Error).message}`);
      return undefined;
    }
  }
}
