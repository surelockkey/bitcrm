import { JobFieldSettingsService } from 'src/job-field-settings/job-field-settings.service';
import { type CreateDealDto } from 'src/deals/dto/create-deal.dto';

/**
 * Workiz's Field Validation rows (Settings → Field Validation) on `POST
 * /deals`: the rows Workiz has and we lacked — First / Last Name, Client
 * Company Name, Primary / Secondary Phone, Email Address, "External Company
 * or Ad Group" (either one), Client Address, Job Address — judged against the
 * create body and, for the client-owned ones, the client record the API
 * reads for itself (the mobile app shares the API, so the API is the gate).
 */
describe('JobFieldSettingsService — the create gate', () => {
  let repo: { get: jest.Mock; put: jest.Mock };
  let service: JobFieldSettingsService;

  const dto = (over: Partial<CreateDealDto> = {}): CreateDealDto =>
    ({
      contactId: 'contact-1',
      clientType: 'residential',
      address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06101' },
      jobTypeId: 'jt-1',
      ...over,
    }) as CreateDealDto;

  const stored = (required: Record<string, boolean>) => {
    repo.get.mockResolvedValue({ requiredFields: required });
  };

  beforeEach(() => {
    repo = { get: jest.fn().mockResolvedValue(null), put: jest.fn().mockResolvedValue(undefined) };
    service = new JobFieldSettingsService(repo as never);
  });

  it('knows every Workiz row by id, so the page can switch it on', async () => {
    const s = await service.get();
    for (const id of [
      'firstName',
      'lastName',
      'companyName',
      'phone',
      'secondaryPhone',
      'email',
      'externalCompanyOrSource',
      'clientAddress',
      'address',
    ]) {
      expect(s.requiredFields).toHaveProperty(id);
    }
    expect(s.requiredFields.firstName).toBe(false);
    expect(s.requiredFields.address).toBe(true);
  });

  it('"External Company or Ad Group" is satisfied by either one, and names itself in Workiz\'s words', async () => {
    stored({ externalCompanyOrSource: true });

    expect(await service.missingRequiredForCreate(dto())).toEqual([
      { id: 'externalCompanyOrSource', label: 'External Company or Ad Group' },
    ]);
    expect(await service.missingRequiredForCreate(dto({ sourceId: 'src-1' }))).toEqual([]);
    expect(await service.missingRequiredForCreate(dto({ externalCompanyId: 'ext-1' }))).toEqual([]);
  });

  it('labels the job address and the client fields as Workiz does', async () => {
    stored({ address: true, phone: true, email: true });
    const load = jest.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace', phones: [], emails: [] });

    expect(await service.missingRequiredForCreate(dto({ address: { street: ' ' } as never }), load)).toEqual([
      { id: 'phone', label: 'Primary Phone' },
      { id: 'email', label: 'Email Address' },
      { id: 'address', label: 'Job Address' },
    ]);
  });

  it('reads the client-owned rows off the client the loader gives', async () => {
    // Job Address is on by default; off here so only the client-owned rows speak.
    stored({ firstName: true, lastName: true, companyName: true, secondaryPhone: true, clientAddress: true, address: false });
    const load = jest.fn().mockResolvedValue({
      firstName: 'Ada',
      lastName: '',
      phones: ['+18605550100'],
      emails: [],
      addresses: [],
    });

    const missing = await service.missingRequiredForCreate(dto({ address: { street: '' } as never }), load);

    expect(missing.map((m) => m.id)).toEqual(['lastName', 'companyName', 'secondaryPhone', 'clientAddress']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a company on the create body or on the client is a Client Company Name; the job address counts as the client\'s', async () => {
    stored({ companyName: true, clientAddress: true, address: false });
    const load = jest.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'L', phones: [], emails: [], addresses: [] });

    expect(await service.missingRequiredForCreate(dto({ companyId: 'co-1' }), load)).toEqual([]);

    load.mockResolvedValue({ firstName: 'Ada', lastName: 'L', companyId: 'co-2', phones: [], emails: [], addresses: [] });
    expect(await service.missingRequiredForCreate(dto(), load)).toEqual([]);

    load.mockResolvedValue({ firstName: 'Ada', lastName: 'L', phones: [], emails: [], addresses: [{ street: '9 Elm' }] });
    expect(await service.missingRequiredForCreate(dto({ address: { street: '' } as never }), load)).toEqual([
      { id: 'companyName', label: 'Client Company Name' },
    ]);
  });

  it('does not read the client at all when no client-owned row is on', async () => {
    stored({ address: true, source: true });
    const load = jest.fn();

    const missing = await service.missingRequiredForCreate(dto(), load);

    expect(missing).toEqual([{ id: 'source', label: 'Job source' }]);
    expect(load).not.toHaveBeenCalled();
  });

  it('leaves the client-owned rows to the form when the client cannot be read (no loader, nothing, or an error)', async () => {
    stored({ firstName: true, source: true });

    expect(await service.missingRequiredForCreate(dto())).toEqual([{ id: 'source', label: 'Job source' }]);
    expect(await service.missingRequiredForCreate(dto(), jest.fn().mockResolvedValue(null))).toEqual([
      { id: 'source', label: 'Job source' },
    ]);
    expect(await service.missingRequiredForCreate(dto(), jest.fn().mockRejectedValue(new Error('crm down')))).toEqual([
      { id: 'source', label: 'Job source' },
    ]);
  });

  it('still rejects an id it does not know on update', async () => {
    await expect(service.update({ requiredFields: { parts: true } }, { id: 'admin-1' } as never)).rejects.toThrow(
      /Unknown job field id/,
    );
  });
});
