import { S3Service } from '../../../src/storage/s3.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'PutObject' })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'GetObject' })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'DeleteObject' })),
}));

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.S3_BUCKET = 'test-bucket';
    service = new S3Service();
  });
  afterEach(() => {
    delete process.env.S3_BUCKET;
    delete process.env.DOCUMENTS_BUCKET;
  });

  describe('getPresignedUploadUrl (legacy string signature)', () => {
    it('generates a URL with bucket, key, contentType, default 300s', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3/upload');
      const result = await service.getPresignedUploadUrl('products/photo.png', 'image/png');
      expect(result).toBe('https://s3/upload');
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'products/photo.png',
        ContentType: 'image/png',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 300 });
    });
  });

  describe('getPresignedUploadUrl (options with SSE-KMS)', () => {
    it('enforces aws:kms server-side encryption and signs the SSE headers', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3/upload-kms');
      await service.getPresignedUploadUrl('technicians/t1/drivers_license', {
        contentType: 'image/jpeg',
        expiresIn: 120,
        kmsKeyId: 'alias/docs',
      });
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: 'alias/docs',
        }),
      );
      const opts = mockGetSignedUrl.mock.calls[0][2];
      expect(opts.expiresIn).toBe(120);
      expect([...opts.signableHeaders]).toContain('x-amz-server-side-encryption');
    });
  });

  describe('getPresignedUpload (url + headers)', () => {
    it('returns only Content-Type when no KMS key', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3/upload');
      const { url, headers } = await service.getPresignedUpload('products/photo.png', {
        contentType: 'image/png',
      });
      expect(url).toBe('https://s3/upload');
      expect(headers).toEqual({ 'Content-Type': 'image/png' });
    });

    it('returns the SSE-KMS headers the client must replay', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3/upload-kms');
      const { headers } = await service.getPresignedUpload('technicians/t1/dl', {
        contentType: 'image/jpeg',
        kmsKeyId: 'alias/docs',
      });
      expect(headers).toEqual({
        'Content-Type': 'image/jpeg',
        'x-amz-server-side-encryption': 'aws:kms',
        'x-amz-server-side-encryption-aws-kms-key-id': 'alias/docs',
      });
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('generates a download URL (default 3600s)', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3/download');
      const result = await service.getPresignedDownloadUrl('k');
      expect(result).toBe('https://s3/download');
      expect(mockGetSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), { expiresIn: 3600 });
    });
  });

  describe('deleteObject', () => {
    it('sends DeleteObjectCommand', async () => {
      mockSend.mockResolvedValue({});
      await service.deleteObject('k');
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'k' });
    });
  });

  describe('bucket selection', () => {
    it('prefers DOCUMENTS_BUCKET when set', () => {
      process.env.DOCUMENTS_BUCKET = 'docs-bucket';
      const s = new S3Service();
      expect((s as unknown as { bucket: string }).bucket).toBe('docs-bucket');
    });
  });
});
