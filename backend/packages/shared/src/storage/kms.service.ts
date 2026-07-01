import { Injectable } from '@nestjs/common';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

/**
 * Field-level encryption via AWS KMS (AES-256 under the hood). Suitable for
 * small sensitive strings (SSN, bank account #) — well under the 4KB KMS
 * plaintext limit. Ciphertext is stored base64-encoded.
 */
@Injectable()
export class KmsService {
  private readonly client: KMSClient;
  private readonly keyId: string;

  constructor() {
    this.keyId = process.env.DOCUMENTS_KMS_KEY_ID || 'alias/bitcrm-documents';
    this.client = new KMSClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.AWS_ENDPOINT && {
        endpoint: process.env.AWS_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    });
  }

  async encrypt(plaintext: string): Promise<string> {
    const res = await this.client.send(
      new EncryptCommand({
        KeyId: this.keyId,
        Plaintext: Buffer.from(plaintext, 'utf-8'),
      }),
    );
    return Buffer.from(res.CiphertextBlob as Uint8Array).toString('base64');
  }

  async decrypt(ciphertextB64: string): Promise<string> {
    const res = await this.client.send(
      new DecryptCommand({
        KeyId: this.keyId,
        CiphertextBlob: Buffer.from(ciphertextB64, 'base64'),
      }),
    );
    return Buffer.from(res.Plaintext as Uint8Array).toString('utf-8');
  }

  /** Returns a display-safe mask exposing only the last `visible` characters. */
  mask(value: string, visible = 4): string {
    if (!value) return '';
    if (value.length <= visible) return '•'.repeat(value.length);
    return '•'.repeat(value.length - visible) + value.slice(-visible);
  }
}
