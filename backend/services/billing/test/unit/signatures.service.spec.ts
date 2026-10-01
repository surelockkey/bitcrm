import { BadRequestException } from '@nestjs/common';
import type { DocumentSignature } from '@bitcrm/types';
import { SignaturesService } from 'src/signatures/signatures.service';
import { NOW } from './mocks';

const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function mockRepo() {
  const rows: DocumentSignature[] = [];
  return {
    rows,
    put: jest.fn(async (s: DocumentSignature) => void rows.push(s)),
    list: jest.fn(async (kind: string, documentId: string) =>
      rows.filter((r) => r.kind === kind && r.documentId === documentId).sort((a, b) => a.signedAt.localeCompare(b.signedAt)),
    ),
  };
}

function mockAssets() {
  return {
    storeImage: jest.fn(async (_buf: Buffer, contentType: string) => ({ id: 'asset-sig-1', contentType })),
    getUrl: jest.fn(async (id: string) => ({ url: `https://s3/${id}` })),
    getDataUri: jest.fn(async () => PNG_1X1),
  };
}

describe('SignaturesService', () => {
  let repo: ReturnType<typeof mockRepo>;
  let assets: ReturnType<typeof mockAssets>;
  let service: SignaturesService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW));
    repo = mockRepo();
    assets = mockAssets();
    service = new SignaturesService(repo as never, assets as never);
  });
  afterEach(() => jest.useRealTimers());

  it('stores the PNG as a billing asset and the signature row next to its document', async () => {
    const sig = await service.collect({
      kind: 'estimate',
      documentId: 'est-1',
      dealId: 'deal-1',
      contactId: 'contact-1',
      imageDataUrl: PNG_1X1,
      signedBy: '  Denielle Morris ',
      source: 'portal',
      ip: '203.0.113.9',
    });
    expect(assets.storeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', 'client');
    expect(sig).toMatchObject({
      kind: 'estimate',
      documentId: 'est-1',
      assetId: 'asset-sig-1',
      signedBy: 'Denielle Morris',
      signedAt: NOW,
      source: 'portal',
      ip: '203.0.113.9',
    });
    expect(repo.put).toHaveBeenCalledWith(sig);
  });

  it('an in-person signature records who collected it', async () => {
    const sig = await service.collect({
      kind: 'invoice',
      documentId: 'deal-1',
      contactId: 'contact-1',
      imageDataUrl: PNG_1X1,
      signedBy: 'Jane Client',
      source: 'app',
      collectedBy: 'tech-7',
    });
    expect(sig.collectedBy).toBe('tech-7');
    expect(assets.storeImage).toHaveBeenCalledWith(expect.any(Buffer), 'image/png', 'tech-7');
  });

  it('refuses anything but a PNG/JPEG data URL, an oversized image, or a blank signer', async () => {
    const base = { kind: 'estimate' as const, documentId: 'e', contactId: 'c', source: 'portal' as const };
    await expect(service.collect({ ...base, imageDataUrl: 'https://evil/x.png', signedBy: 'A' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.collect({ ...base, imageDataUrl: 'data:text/html;base64,PGI+', signedBy: 'A' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const huge = `data:image/png;base64,${Buffer.alloc(600 * 1024, 1).toString('base64')}`;
    await expect(service.collect({ ...base, imageDataUrl: huge, signedBy: 'A' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.collect({ ...base, imageDataUrl: PNG_1X1, signedBy: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('lists a document’s signatures with a viewable URL, oldest first', async () => {
    await service.collect({ kind: 'estimate', documentId: 'est-1', contactId: 'c', imageDataUrl: PNG_1X1, signedBy: 'A', source: 'portal' });
    jest.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
    await service.collect({ kind: 'estimate', documentId: 'est-1', contactId: 'c', imageDataUrl: PNG_1X1, signedBy: 'B', source: 'app' });
    const list = await service.list('estimate', 'est-1');
    expect(list.map((s) => s.signedBy)).toEqual(['A', 'B']);
    expect(list[0].imageUrl).toBe('https://s3/asset-sig-1');
    expect((list[0] as unknown as { assetId?: string }).assetId).toBeUndefined();
  });

  it('says whether a document has any signature on file, without minting image URLs', async () => {
    expect(await service.hasAny('invoice', 'deal-1')).toBe(false);
    await service.collect({ kind: 'invoice', documentId: 'deal-1', contactId: 'c', imageDataUrl: PNG_1X1, signedBy: 'A', source: 'app' });
    expect(await service.hasAny('invoice', 'deal-1')).toBe(true);
    expect(await service.hasAny('estimate', 'deal-1')).toBe(false);
    expect(assets.getUrl).not.toHaveBeenCalled();
  });

  it('the render context gets the LATEST signature inlined as a data URI', async () => {
    expect(await service.forRender('estimate', 'est-1')).toBeUndefined();
    await service.collect({ kind: 'estimate', documentId: 'est-1', contactId: 'c', imageDataUrl: PNG_1X1, signedBy: 'A', source: 'portal' });
    jest.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
    await service.collect({ kind: 'estimate', documentId: 'est-1', contactId: 'c', imageDataUrl: PNG_1X1, signedBy: 'B', source: 'app' });
    const sig = await service.forRender('estimate', 'est-1');
    expect(sig).toEqual({ imageUrl: PNG_1X1, signedBy: 'B', signedAt: '2026-09-17T10:00:00.000Z' });
  });
});
