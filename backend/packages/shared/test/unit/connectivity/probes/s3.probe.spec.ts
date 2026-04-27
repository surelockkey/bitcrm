import { S3Probe } from '../../../../src/connectivity/probes/s3.probe';

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  HeadBucketCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

import { S3Client } from '@aws-sdk/client-s3';

describe('S3Probe', () => {
  let client: S3Client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new S3Client({});
  });

  it('returns ok when all buckets accessible', async () => {
    mockSend.mockResolvedValue({});
    const probe = new S3Probe(client, ['a', 'b']);

    const out = await probe.run();

    expect(out.ok).toBe(true);
    expect(out.resources?.every((r) => r.present)).toBe(true);
  });

  it('returns ok=false when a bucket head fails', async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { name: 'NotFound' }));
    const probe = new S3Probe(client, ['ok-bucket', 'missing']);

    const out = await probe.run();

    expect(out.ok).toBe(false);
    expect(out.resources).toEqual([
      { resource: 'ok-bucket', present: true },
      { resource: 'missing', present: false, details: 'NotFound' },
    ]);
  });
});
