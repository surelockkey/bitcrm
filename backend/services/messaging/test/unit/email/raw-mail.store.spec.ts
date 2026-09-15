import { GetObjectCommand } from '@aws-sdk/client-s3';
import { RawMailStore } from '../../../src/email/inbound/raw-mail.store';

describe('RawMailStore', () => {
  it('reads the object the notification names and hands the bytes back', async () => {
    const client = { send: jest.fn(async () => ({ Body: { transformToByteArray: async () => Uint8Array.from(Buffer.from('From: a@b.co\r\n\r\nhi')) } })) };
    const store = new RawMailStore({ awsRegion: 'us-east-1' }, client as any);
    const raw = await store.get('bucket', 'messaging/inbound-email/x');
    expect(raw.toString()).toBe('From: a@b.co\r\n\r\nhi');
    const cmd = (client.send.mock.calls as unknown[][])[0][0] as GetObjectCommand;
    expect(cmd).toBeInstanceOf(GetObjectCommand);
    expect(cmd.input).toEqual({ Bucket: 'bucket', Key: 'messaging/inbound-email/x' });
  });

  it('throws on an object without a body and propagates S3 errors', async () => {
    await expect(new RawMailStore({ awsRegion: 'us-east-1' }, { send: jest.fn(async () => ({})) } as any).get('b', 'k')).rejects.toThrow(/no body/);
    await expect(new RawMailStore({ awsRegion: 'us-east-1' }, { send: jest.fn().mockRejectedValue(new Error('NoSuchKey')) } as any).get('b', 'k')).rejects.toThrow('NoSuchKey');
  });

  it('builds its own client from the config when none is given', () => {
    expect(() => new RawMailStore({ awsRegion: 'us-east-1', awsEndpoint: 'http://localhost:4566' })).not.toThrow();
  });
});
