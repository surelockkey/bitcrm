import { KmsService } from '../../../src/storage/kms.service';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-kms', () => ({
  KMSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  EncryptCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'Encrypt' })),
  DecryptCommand: jest.fn().mockImplementation((input) => ({ input, _type: 'Decrypt' })),
}));

describe('KmsService', () => {
  let service: KmsService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DOCUMENTS_KMS_KEY_ID = 'alias/test-key';
    service = new KmsService();
  });

  afterEach(() => delete process.env.DOCUMENTS_KMS_KEY_ID);

  describe('encrypt', () => {
    it('calls KMS Encrypt with the key + plaintext and returns base64 ciphertext', async () => {
      mockSend.mockResolvedValue({ CiphertextBlob: new Uint8Array([1, 2, 3, 4]) });
      const out = await service.encrypt('123-45-6789');

      const { EncryptCommand } = require('@aws-sdk/client-kms');
      expect(EncryptCommand).toHaveBeenCalledWith(
        expect.objectContaining({ KeyId: 'alias/test-key' }),
      );
      // plaintext passed as the utf-8 bytes of the input
      const passed = EncryptCommand.mock.calls[0][0].Plaintext;
      expect(Buffer.from(passed).toString('utf-8')).toBe('123-45-6789');
      expect(out).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
    });
  });

  describe('decrypt', () => {
    it('round-trips a base64 ciphertext back to plaintext', async () => {
      mockSend.mockResolvedValue({ Plaintext: Buffer.from('secret', 'utf-8') });
      const out = await service.decrypt(Buffer.from([9, 9]).toString('base64'));

      const { DecryptCommand } = require('@aws-sdk/client-kms');
      expect(DecryptCommand).toHaveBeenCalledTimes(1);
      expect(out).toBe('secret');
    });
  });

  describe('mask', () => {
    it('shows only the last 4 characters', () => {
      expect(service.mask('123-45-6789')).toBe('•••••••6789');
      expect(service.mask('12345678', 4)).toBe('••••5678');
    });

    it('fully masks short values', () => {
      expect(service.mask('123')).toBe('•••');
    });

    it('handles empty/undefined', () => {
      expect(service.mask('')).toBe('');
      expect(service.mask(undefined as never)).toBe('');
    });
  });
});
