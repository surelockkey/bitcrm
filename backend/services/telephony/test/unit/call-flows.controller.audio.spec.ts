import { NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { CallFlowsController } from '../../src/call-flows/call-flows.controller';

/**
 * GET /call-flows/audio/:id — an uploaded recording, for the office to
 * listen to (the hold music preview). `/voice/audio/:id` is Twilio's: it
 * answers signed requests only, so a browser cannot play from it.
 */
function make(read: jest.Mock) {
  return new CallFlowsController({} as never, { read } as never);
}

function makeRes() {
  const chunks: Buffer[] = [];
  const res = new (require('stream').Writable)({
    write(chunk: Buffer, _enc: string, cb: () => void) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  res.set = jest.fn();
  return { res, body: () => Buffer.concat(chunks).toString() };
}

describe('CallFlowsController.playAudio', () => {
  it('streams the recording with its content type', async () => {
    const read = jest.fn().mockResolvedValue({ body: Readable.from(['ID3-bytes']), contentType: 'audio/mpeg' });
    const { res, body } = makeRes();

    await make(read).playAudio('3f1c2a4e-9b7d-4c1e-8a2f-0d6e5b4c3a21', res as never);
    await new Promise((r) => res.on('finish', r));

    expect(read).toHaveBeenCalledWith('3f1c2a4e-9b7d-4c1e-8a2f-0d6e5b4c3a21');
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Type': 'audio/mpeg' }));
    expect(body()).toBe('ID3-bytes');
  });

  it('is 404 for a recording we do not have', async () => {
    const { res } = makeRes();
    await expect(make(jest.fn().mockResolvedValue(null)).playAudio('nope', res as never)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
