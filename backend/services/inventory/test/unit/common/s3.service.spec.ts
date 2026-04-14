import { S3Service } from 'src/common/s3/s3.service';

// Mock the S3 client and presigner before importing the service
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'PutObject' })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'GetObject' })),
    DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'DeleteObject' })),
  };
});

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
  });

  describe('getPresignedUploadUrl', () => {
    it('should generate URL with correct bucket, key, and contentType', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/upload-url');

      const result = await service.getPresignedUploadUrl('products/photo.png', 'image/png');

      expect(result).toBe('https://s3.example.com/upload-url');
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'products/photo.png',
        ContentType: 'image/png',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ input: expect.objectContaining({ Bucket: 'test-bucket' }) }),
        { expiresIn: 300 },
      );
    });

    it('should use custom expiresIn', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/upload-url');

      await service.getPresignedUploadUrl('key', 'image/jpeg', 600);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 600 },
      );
    });
  });

  describe('getPresignedDownloadUrl', () => {
    it('should generate download URL', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/download-url');

      const result = await service.getPresignedDownloadUrl('products/photo.png');

      expect(result).toBe('https://s3.example.com/download-url');
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'products/photo.png',
      });
      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 3600 },
      );
    });

    it('should use custom expiresIn', async () => {
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/download-url');

      await service.getPresignedDownloadUrl('key', 7200);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });
  });

  describe('deleteObject', () => {
    it('should send DeleteObjectCommand with correct bucket and key', async () => {
      mockSend.mockResolvedValue({});

      await service.deleteObject('products/photo.png');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
      expect(DeleteObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'products/photo.png',
      });
    });
  });
});
