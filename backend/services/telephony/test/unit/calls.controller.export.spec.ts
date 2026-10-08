import { CallsController } from '../../src/calls/calls.controller';
import { type CallsService } from '../../src/calls/calls.service';
import { type CallsExportService } from '../../src/calls/calls-export.service';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';

/**
 * `GET /calls/export.csv` — the list's filters, streamed as Workiz's CSV.
 */

const USER = { id: 'disp-1' } as JwtUser;

function make(exportImpl?: (...args: unknown[]) => Promise<unknown>, maySee = true) {
  const exporter = {
    stream: jest.fn(
      exportImpl ??
        (async (_f: unknown, _o: unknown, sink: { write: (c: string) => Promise<void> }) => {
          await sink.write('Status,From\n');
          await sink.write('Incoming call,Jane\n');
          return { rows: 1, truncated: false };
        }),
    ),
  } as unknown as CallsExportService;
  const permissions = { maySeeClientNumbers: jest.fn().mockResolvedValue(maySee) };
  const none = {} as never;
  const controller = new CallsController(
    {} as CallsService,
    none, none, none, none, none, none,
    permissions as never,
    none, none,
    {} as never,
    undefined,
    exporter,
  );
  return { controller, exporter };
}

function makeRes() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  const res = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn((k: string, v: string) => void (headers[k] = v)),
    write: jest.fn((c: string) => {
      chunks.push(c);
      return true;
    }),
    once: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  return { res, headers, chunks };
}

const req = (financials: boolean) => ({
  resolvedPermissions: {
    permissions: { calls: { view: true }, financials: { view: financials } },
    dataScope: {},
  } as unknown as ResolvedPermissions,
});

describe('CallsController.exportCsv', () => {
  it('streams text/csv as an attachment named after the window', async () => {
    const { controller } = make();
    const { res, headers, chunks } = makeRes();

    await controller.exportCsv(
      { dateFrom: '2026-10-08T04:00:00.000Z', dateTo: '2026-10-09T03:59:59.999Z' },
      USER,
      req(true),
      res as never,
      'Bearer tok',
    );

    expect(headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(headers['Content-Disposition']).toBe('attachment; filename="calls-2026-10-08_2026-10-09.csv"');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(chunks.join('')).toBe('Status,From\nIncoming call,Jane\n');
    expect(res.end).toHaveBeenCalled();
  });

  it('hands the exporter the list’s filter, the viewer’s grants and their token', async () => {
    const { controller, exporter } = make(undefined, false);
    const { res } = makeRes();

    await controller.exportCsv({ status: 'missed,active', q: 'Roe', limit: '10' }, USER, req(false), res as never, 'Bearer tok');

    const [filter, opts] = (exporter.stream as jest.Mock).mock.calls[0];
    expect(filter).toEqual({ status: 'missed,active', search: { text: 'roe' } });
    expect(opts).toMatchObject({ money: false, maySeeNumbers: false, authorization: 'Bearer tok' });
    expect(typeof opts.name).toBe('function');
  });

  it('a failure before the first byte is an ordinary error response', async () => {
    const { controller } = make(async () => {
      throw new Error('boom');
    });
    const { res } = makeRes();

    await expect(controller.exportCsv({}, USER, req(true), res as never, 'Bearer tok')).rejects.toThrow('boom');
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('a failure mid-stream cuts the connection rather than finishing a short file', async () => {
    const { controller } = make(async (_f, _o, sink) => {
      await (sink as { write: (c: string) => Promise<void> }).write('Status\n');
      throw new Error('dynamo');
    });
    const { res } = makeRes();

    await controller.exportCsv({}, USER, req(true), res as never, 'Bearer tok');

    expect(res.destroy).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });
});
