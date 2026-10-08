import { MainNumberService } from '../../src/telephony/main-number.service';
import { TelephonyController } from '../../src/telephony/telephony.controller';

/**
 * Номер робочого простору — пігулка біля «Workiz Phone» на сторінці дзвінків.
 * Це типовий відправник (Settings → Messaging → Default number), який
 * messaging тримає за `settings.view`; telephony бере його внутрішнім
 * маршрутом і віддає в `GET /telephony/config` кожному.
 */

function fetchReturning(...answers: Array<{ ok: boolean; status?: number; body?: unknown } | Error>) {
  let i = 0;
  return jest.fn(async () => {
    const a = answers[Math.min(i++, answers.length - 1)];
    if (a instanceof Error) throw a;
    return { ok: a.ok, status: a.status ?? (a.ok ? 200 : 500), json: async () => a.body } as Response;
  });
}

describe('MainNumberService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('asks messaging for the default sender, with the internal secret', async () => {
    const fetchMock = fetchReturning({ ok: true, body: { data: { mainNumber: '+12034036303' } } });
    global.fetch = fetchMock as never;

    await expect(new MainNumberService({ callerId: '' } as never).mainNumber()).resolves.toBe('+12034036303');
    const [url, init] = (fetchMock.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toMatch(/\/api\/messaging\/settings\/internal\/main-number$/);
    expect((init.headers as Record<string, string>)['x-internal-secret']).toBeDefined();
  });

  it('no default sender → the workspace caller id (TWILIO_CALLER_ID), else null', async () => {
    global.fetch = fetchReturning({ ok: true, body: { data: { mainNumber: null } } }) as never;

    await expect(new MainNumberService({ callerId: '+15550001111' } as never).mainNumber()).resolves.toBe('+15550001111');
    await expect(new MainNumberService({ callerId: '' } as never).mainNumber()).resolves.toBeNull();
  });

  it('is asked once a minute, not on every page load', async () => {
    const fetchMock = fetchReturning({ ok: true, body: { data: { mainNumber: '+12034036303' } } });
    global.fetch = fetchMock as never;
    const service = new MainNumberService({ callerId: '' } as never);

    await service.mainNumber();
    await service.mainNumber();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('messaging down → the last answer it gave, never an error', async () => {
    const fetchMock = fetchReturning({ ok: true, body: { data: { mainNumber: '+12034036303' } } }, new Error('ECONNREFUSED'));
    global.fetch = fetchMock as never;
    const now = jest.spyOn(Date, 'now');
    const service = new MainNumberService({ callerId: '' } as never);

    now.mockReturnValue(1_000_000);
    await service.mainNumber();
    now.mockReturnValue(1_000_000 + 120_000);
    await expect(service.mainNumber()).resolves.toBe('+12034036303');
    now.mockRestore();
  });

  it('messaging down with nothing known → the caller id fallback', async () => {
    global.fetch = fetchReturning({ ok: false, status: 503 }) as never;

    await expect(new MainNumberService({ callerId: '+15550001111' } as never).mainNumber()).resolves.toBe('+15550001111');
  });
});

describe('TelephonyController.telephonyConfig', () => {
  it('serves the main number beside the technician line, to any signed-in user', async () => {
    const settings = { technicianLine: jest.fn().mockResolvedValue('+15550002222') };
    const main = { mainNumber: jest.fn().mockResolvedValue('+12034036303') };
    const controller = new TelephonyController({} as never, settings as never, main as never);

    await expect(controller.telephonyConfig()).resolves.toEqual({
      success: true,
      data: { technicianLine: '+15550002222', mainNumber: '+12034036303' },
    });
  });
});
