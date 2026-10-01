import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SIGNATURE_IMAGE_TYPES,
  SIGNATURE_MAX_BYTES,
  SIGNER_NAME_MAX_LENGTH,
  type DocumentSignature,
  type DocumentSignatureView,
  type SignatureDocumentKind,
  type SignatureSource,
} from '@bitcrm/types';
import { AssetsService } from '../assets/assets.service';
import { SignaturesRepository } from './signatures.repository';

export interface CollectSignatureInput {
  kind: SignatureDocumentKind;
  documentId: string;
  dealId?: string;
  contactId: string;
  /** `data:image/png;base64,…` from the signature canvas (or a JPEG from the app). */
  imageDataUrl: string;
  signedBy: string;
  source: SignatureSource;
  /** Staff user, for an in-person (`app`) signature. */
  collectedBy?: string;
  ip?: string;
}

/** The shape every document template prints: the latest signature. */
export interface RenderSignature {
  imageUrl: string;
  signedBy: string;
  signedAt: string;
}

const DATA_URL = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/;

/**
 * Collecting and reading client signatures. The image goes to S3 as a
 * billing asset (same place as logos and template images), the row next to
 * its document. Signatures are append-only: a document never loses one.
 */
@Injectable()
export class SignaturesService {
  constructor(
    private readonly repo: SignaturesRepository,
    private readonly assets: AssetsService,
  ) {}

  async collect(input: CollectSignatureInput): Promise<DocumentSignature> {
    const signedBy = (input.signedBy ?? '').trim();
    if (!signedBy) throw new BadRequestException('Please type your name to sign');
    if (signedBy.length > SIGNER_NAME_MAX_LENGTH) {
      throw new BadRequestException(`The signer name cannot be longer than ${SIGNER_NAME_MAX_LENGTH} characters`);
    }
    const { buffer, contentType } = decodeSignatureImage(input.imageDataUrl);

    const { id: assetId } = await this.assets.storeImage(buffer, contentType, input.collectedBy ?? 'client');
    const sig: DocumentSignature = {
      id: randomUUID(),
      kind: input.kind,
      documentId: input.documentId,
      ...(input.dealId && { dealId: input.dealId }),
      contactId: input.contactId,
      assetId,
      signedBy,
      signedAt: new Date().toISOString(),
      source: input.source,
      ...(input.collectedBy && { collectedBy: input.collectedBy }),
      ...(input.ip && { ip: input.ip }),
    };
    await this.repo.put(sig);
    return sig;
  }

  /** Oldest first, each with a short-lived viewable URL instead of the asset id. */
  async list(kind: SignatureDocumentKind, documentId: string): Promise<DocumentSignatureView[]> {
    const rows = await this.repo.list(kind, documentId);
    return Promise.all(
      rows.map(async ({ assetId, ...rest }) => ({
        ...rest,
        imageUrl: await this.assets
          .getUrl(assetId)
          .then((r) => r.url)
          .catch(() => ''),
      })),
    );
  }

  /** Whether ANY signature is on file — no image URLs are made (a payment gate, not a view). */
  async hasAny(kind: SignatureDocumentKind, documentId: string): Promise<boolean> {
    return (await this.repo.list(kind, documentId)).length > 0;
  }

  /** The LATEST signature, inlined for the PDF browser (which has no network); undefined when unsigned. */
  async forRender(kind: SignatureDocumentKind, documentId: string): Promise<RenderSignature | undefined> {
    const rows = await this.repo.list(kind, documentId);
    const latest = rows[rows.length - 1];
    if (!latest) return undefined;
    const imageUrl = await this.assets.getDataUri(latest.assetId);
    if (!imageUrl) return undefined;
    return { imageUrl, signedBy: latest.signedBy, signedAt: latest.signedAt };
  }
}

/** Parses the canvas' data URL; refuses anything but a small PNG/JPEG. */
export function decodeSignatureImage(dataUrl: string): { buffer: Buffer; contentType: string } {
  const m = typeof dataUrl === 'string' ? DATA_URL.exec(dataUrl) : null;
  if (!m) throw new BadRequestException('The signature must be a PNG or JPEG image');
  const contentType = m[1];
  if (!(SIGNATURE_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    throw new BadRequestException('The signature must be a PNG or JPEG image');
  }
  const base64 = m[2].replace(/\s+/g, '');
  // 4 base64 chars ≈ 3 bytes: refuse before decoding something huge.
  if ((base64.length * 3) / 4 > SIGNATURE_MAX_BYTES) {
    throw new BadRequestException('The signature image is too large');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.byteLength === 0 || buffer.byteLength > SIGNATURE_MAX_BYTES) {
    throw new BadRequestException('The signature image is too large');
  }
  return { buffer, contentType };
}
