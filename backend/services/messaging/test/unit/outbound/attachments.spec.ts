import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OutboundAttachmentsService } from '../../../src/outbound/attachments/attachments.service';
import { RequestAttachmentUploadDto } from '../../../src/outbound/attachments/dto/request-attachment-upload.dto';
import { createMockMessage } from '../mocks';

const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };

function makeService() {
  const s3 = {
    getPresignedUpload: jest.fn(async (key: string, opts: { contentType: string; kmsKeyId?: string }) => ({
      url: `https://s3/put/${key}`,
      headers: {
        'Content-Type': opts.contentType,
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': opts.kmsKeyId ?? '',
      },
    })),
    getPresignedDownloadUrl: jest.fn(async (key: string, ttl: number) => `https://s3/get/${key}?ttl=${ttl}`),
  };
  const service = new OutboundAttachmentsService(s3 as any, {
    kmsKeyId: 'alias/bitcrm-documents',
    uploadUrlTtlSeconds: 300,
    mediaUrlTtlSeconds: 3600,
  });
  return { service, s3 };
}

describe('OutboundAttachmentsService.requestUpload', () => {
  it("presigns a KMS PUT under the caller's own upload prefix and returns the id to send with", async () => {
    const { service, s3 } = makeService();
    const res = await service.requestUpload({ fileName: 'door.jpg', contentType: 'image/jpeg', size: 1024 }, user);

    expect(res.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.s3Key).toBe(`messaging/uploads/u1/${res.id}`);
    expect(res.uploadUrl).toBe(`https://s3/put/${res.s3Key}`);
    expect(res.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'x-amz-server-side-encryption': 'aws:kms',
      'x-amz-server-side-encryption-aws-kms-key-id': 'alias/bitcrm-documents',
    });
    expect(res).toMatchObject({ expiresIn: 300, fileName: 'door.jpg', contentType: 'image/jpeg', size: 1024, maxBytes: 5 * 1024 * 1024 });
    expect(s3.getPresignedUpload).toHaveBeenCalledWith(res.s3Key, { contentType: 'image/jpeg', expiresIn: 300, kmsKeyId: 'alias/bitcrm-documents' });
  });

  it('mints a fresh id per request', async () => {
    const { service } = makeService();
    const dto = { fileName: 'a.png', contentType: 'image/png' as const, size: 1 };
    const [a, b] = await Promise.all([service.requestUpload(dto, user), service.requestUpload(dto, user)]);
    expect(a.id).not.toBe(b.id);
  });
});

describe('OutboundAttachmentsService.mediaUrlsFor', () => {
  it('presigns a GET per stored attachment with the media TTL, in order, skipping the rest', async () => {
    const { service, s3 } = makeService();
    const message = createMockMessage({
      attachments: [
        { id: 'a1', fileName: '1.jpg', contentType: 'image/jpeg', status: 'stored', s3Key: 'messaging/uploads/u1/a1' },
        { id: 'a2', fileName: '2.jpg', contentType: 'image/jpeg', status: 'pending' },
        { id: 'a3', fileName: '3.jpg', contentType: 'image/jpeg', status: 'deferred', sourceUrl: 'https://st.sendajob.com/x' },
        { id: 'a4', fileName: '4.pdf', contentType: 'application/pdf', status: 'stored', s3Key: 'messaging/uploads/u1/a4' },
      ],
    });
    expect(await service.mediaUrlsFor(message)).toEqual([
      'https://s3/get/messaging/uploads/u1/a1?ttl=3600',
      'https://s3/get/messaging/uploads/u1/a4?ttl=3600',
    ]);
    expect(s3.getPresignedDownloadUrl).toHaveBeenCalledTimes(2);
    expect(await service.mediaUrlsFor(createMockMessage())).toEqual([]);
  });
});

describe('RequestAttachmentUploadDto', () => {
  const errorsOf = async (plain: Record<string, unknown>) =>
    (await validate(plainToInstance(RequestAttachmentUploadDto, plain), { whitelist: true })).map((e) => e.property);

  it('accepts the §4.6 types up to 5 MB and rejects everything else', async () => {
    for (const contentType of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/3gpp', 'text/vcard']) {
      expect(await errorsOf({ fileName: 'f', contentType, size: 5 * 1024 * 1024 })).toEqual([]);
    }
    expect(await errorsOf({ fileName: 'f', contentType: 'application/zip', size: 1 })).toEqual(['contentType']);
    expect(await errorsOf({ fileName: 'f', contentType: 'image/heic', size: 1 })).toEqual(['contentType']);
    expect(await errorsOf({ fileName: 'f', contentType: 'image/jpeg', size: 5 * 1024 * 1024 + 1 })).toEqual(['size']);
    expect(await errorsOf({ fileName: 'f', contentType: 'image/jpeg', size: 0 })).toEqual(['size']);
    expect(await errorsOf({ fileName: '', contentType: 'image/jpeg', size: 1 })).toEqual(['fileName']);
    expect(await errorsOf({ fileName: 'x'.repeat(256), contentType: 'image/jpeg', size: 1 })).toEqual(['fileName']);
  });
});
