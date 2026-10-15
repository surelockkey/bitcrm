import { CompanyNumbersCatalog } from 'src/contacts/company-numbers.catalog';

/**
 * The company's own Twilio numbers, as crm needs them to refuse one on a
 * client record (texting it fails with Twilio 21266). Telephony owns the
 * numbers; crm reads its internal listing, caches it, and fails OPEN.
 */
describe('CompanyNumbersCatalog', () => {
  const rows = [
    { phoneNumber: '+14098777774', sid: 'PN1', capabilities: { sms: true, mms: true, voice: true } },
    { phoneNumber: '+18005550100', sid: 'PN2', capabilities: { sms: false, mms: false, voice: true } },
  ];
  const answer = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => ({ success: ok, data }) });

  let fetchImpl: jest.Mock;
  let catalog: CompanyNumbersCatalog;
  const env = { ...process.env };

  beforeEach(() => {
    process.env.TELEPHONY_SERVICE_URL = 'http://telephony:4006';
    process.env.INTERNAL_SERVICE_SECRET = 's3cret';
    fetchImpl = jest.fn().mockResolvedValue(answer(rows));
    catalog = new CompanyNumbersCatalog(fetchImpl);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("reads telephony's internal owned listing with the internal secret — every number, voice-only too", async () => {
    const numbers = await catalog.numbers();

    expect(fetchImpl).toHaveBeenCalledWith('http://telephony:4006/api/telephony/numbers/internal/owned', {
      headers: { 'x-internal-secret': 's3cret' },
    });
    expect(numbers).toEqual(new Set(['+14098777774', '+18005550100']));
  });

  it('asks at most once per cache window', async () => {
    await catalog.numbers();
    await catalog.numbers();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails open: telephony down → an empty set (nothing refused), and the next call asks again', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await catalog.numbers()).toEqual(new Set());

    fetchImpl.mockResolvedValueOnce(answer(null, false));
    expect(await catalog.numbers()).toEqual(new Set());

    expect(await catalog.numbers()).toEqual(new Set(['+14098777774', '+18005550100']));
  });

  it('keeps the last good list when a later refresh fails', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    await catalog.numbers();
    fetchImpl.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    now.mockReturnValue(1_000 + 60 * 60_000);
    expect(await catalog.numbers()).toEqual(new Set(['+14098777774', '+18005550100']));
    now.mockRestore();
  });
});
