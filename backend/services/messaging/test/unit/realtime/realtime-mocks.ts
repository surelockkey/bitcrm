import { RedisService } from '@bitcrm/shared';

/**
 * A `RedisService` whose client records publishes and whose duplicated
 * subscriber connection lets a test inject channel messages.
 */
export function mockRedis() {
  const handlers = new Map<string, (channel: string, message: string) => void>();
  const subscriber = {
    subscribe: jest.fn().mockResolvedValue(1),
    on: jest.fn().mockImplementation((event: string, cb: (channel: string, message: string) => void) => {
      handlers.set(event, cb);
    }),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  const client = {
    publish: jest.fn().mockResolvedValue(1),
    duplicate: jest.fn().mockReturnValue(subscriber),
  };
  const redis = { client } as unknown as RedisService;
  const emit = (message: string) => handlers.get('message')?.('messaging:events', message);
  return { redis, client, subscriber, handlers, emit };
}

/** An express `Response` double for SSE handlers (telephony's `makeRes`). */
export function mockSseResponse() {
  const chunks: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const res = {
    headers: {} as Record<string, string>,
    set: jest.fn(function (h: Record<string, string>) {
      Object.assign(res.headers, h);
    }),
    flushHeaders: jest.fn(),
    write: jest.fn((c: string) => {
      chunks.push(c);
      return true;
    }),
    on: jest.fn((event: string, cb: () => void) => {
      if (event === 'close') closeHandlers.push(cb);
    }),
    end: jest.fn(),
  };
  const frames = () =>
    chunks.filter((c) => c.startsWith('data: ')).map((c) => JSON.parse(c.slice('data: '.length)));
  return { res, chunks, frames, close: () => closeHandlers.forEach((cb) => cb()) };
}

export const flushMicrotasks = async (rounds = 8) => {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
};
