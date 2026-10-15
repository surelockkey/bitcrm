import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { requestLogProps } from '../../../src/logger/request-log-props';

/**
 * Who made a request belongs on its "request completed" line. pino-http binds
 * the `req` serializer when the request ARRIVES — before `CognitoAuthGuard` has
 * put the caller on `req.user` — so a `userId` read there was always empty
 * (the 2026-10-15 deactivation could only be attributed by correlating logins).
 * `customProps` is evaluated again when the response finishes; that is where
 * the caller is read.
 */
describe('requestLogProps', () => {
  it('carries the trace id until the guard has set a caller, then the caller', () => {
    expect(requestLogProps({ id: 'abc12345' } as never)).toEqual({ traceId: 'abc12345' });
    expect(
      requestLogProps({
        id: 'abc12345',
        user: { id: 'u-1', roleId: 'role-admin', email: 'a@b.c', cognitoSub: 's', department: 'office' },
      } as never),
    ).toEqual({ userId: 'u-1', roleId: 'role-admin' });
  });

  it('never logs the email', () => {
    const props = requestLogProps({ id: 't', user: { id: 'u', roleId: 'r', email: 'secret@x.y' } } as never);
    expect(JSON.stringify(props)).not.toContain('secret@x.y');
  });

  it('puts the caller set AFTER the request arrived on the completed line (real pino-http)', () => {
    const { lines, rawLines, run } = harness();
    // What CognitoAuthGuard does, after the logging middleware ran.
    run((req) => {
      req.user = { id: 'u-actor', roleId: 'role-admin', email: 'actor@x.y' };
    });

    const completed = lines.find((l) => l.msg === 'request completed');
    expect(completed).toMatchObject({ traceId: 'trace-1', userId: 'u-actor', roleId: 'role-admin' });
    expect(rawLines.find((l) => l.includes('request completed'))!.match(/"traceId"/g)).toHaveLength(1);
  });

  it('keeps the trace id on a public request (no caller)', () => {
    const { lines, run } = harness();
    run(() => undefined);
    expect(lines.find((l) => l.msg === 'request completed')).toMatchObject({ traceId: 'trace-1' });
  });
});

/** A real pino-http over a captured stream; `afterArrival` plays the guards. */
function harness() {
  const rawLines: string[] = [];
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _enc, done) {
      rawLines.push(String(chunk));
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  const middleware = pinoHttp({
    logger: pino(sink),
    genReqId: (req) => (req as { id?: string }).id ?? 'none',
    customProps: requestLogProps,
  });
  const run = (afterArrival: (req: Record<string, unknown>) => void) => {
    const req = Object.assign(new EventEmitter(), {
      id: 'trace-1',
      method: 'DELETE',
      url: '/api/users/u-target',
      headers: {},
      socket: {},
    }) as never as Record<string, unknown>;
    const res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      getHeaders: () => ({}),
      writableEnded: true,
    });
    middleware(req as never, res as never, () => undefined);
    afterArrival(req);
    res.emit('finish');
  };
  return { lines, rawLines, run };
}
