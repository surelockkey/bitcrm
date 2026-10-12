import { BadGatewayException } from '@nestjs/common';
import { ClientCustomFieldsCatalog } from 'src/contacts/client-custom-fields.catalog';

/**
 * The client custom fields crm checks a contact's answers against. The
 * catalog is deal-service's (Settings → Custom Fields, both tabs); crm reads
 * its internal list and keeps the CLIENT ones.
 */
describe('ClientCustomFieldsCatalog', () => {
  const rows = [
    { id: 'cf-job', name: 'Gate Code', type: 'text', active: true, searchable: false, options: [] },
    { id: 'cf-vendor', name: 'Vendor Number 1', type: 'text', entityType: 'client', active: true, searchable: true, options: [] },
    {
      id: 'cf-platinum',
      name: 'Platinum Company name',
      type: 'dropdown',
      entityType: 'client',
      active: false,
      searchable: true,
      options: ['Sure Lock & Key', 'DBA'],
    },
  ];
  const answer = (data: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => ({ success: ok, data }) });

  let fetchImpl: jest.Mock;
  let catalog: ClientCustomFieldsCatalog;
  const env = { ...process.env };

  beforeEach(() => {
    process.env.DEAL_SERVICE_URL = 'http://deal:4003';
    process.env.INTERNAL_SERVICE_SECRET = 's3cret';
    fetchImpl = jest.fn().mockResolvedValue(answer(rows));
    catalog = new ClientCustomFieldsCatalog(fetchImpl);
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('reads deal-service’s internal list with the internal secret, and keeps the client fields (archived ones too)', async () => {
    const defs = await catalog.list();

    expect(fetchImpl).toHaveBeenCalledWith('http://deal:4003/api/deals/custom-fields/internal', {
      headers: { 'x-internal-secret': 's3cret' },
    });
    expect(defs.map((d) => d.id)).toEqual(['cf-vendor', 'cf-platinum']);
    expect(defs[1]).toMatchObject({ name: 'Platinum Company name', active: false, options: ['Sure Lock & Key', 'DBA'] });
  });

  it('asks once a minute, unless told to ask afresh', async () => {
    await catalog.list();
    await catalog.list();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await catalog.list({ fresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('says so (502) when deal-service cannot be read — never an empty catalog', async () => {
    fetchImpl.mockResolvedValue(answer(null, false));
    await expect(catalog.list()).rejects.toThrow(BadGatewayException);

    fetchImpl.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(catalog.list({ fresh: true })).rejects.toThrow(BadGatewayException);
  });
});
