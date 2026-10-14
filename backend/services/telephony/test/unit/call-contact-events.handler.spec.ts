import { CallContactEventsHandler, CALL_CONTACT_EVENT_TYPES } from '../../src/calls/call-contact-events.handler';

/**
 * Unknown numbers are cached five minutes. When a client is created (the
 * call log's "Add client") or edited, the CRM says so on contact-events —
 * telephony's queue carries that topic too — and the client's numbers and
 * name are dropped from every task's cache, so the log names them at once.
 */
describe('CallContactEventsHandler', () => {
  const OLD = process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
  afterEach(() => {
    if (OLD === undefined) delete process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
    else process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL = OLD;
  });

  function make() {
    const contacts = {
      forgetContact: jest.fn().mockResolvedValue(undefined),
      forgetCompany: jest.fn().mockResolvedValue(undefined),
    };
    return { handler: new CallContactEventsHandler(contacts as never), contacts };
  }

  it('consumes the contact and company events that can rename or claim a number', () => {
    expect([...CALL_CONTACT_EVENT_TYPES].sort()).toEqual(
      ['company.created', 'company.updated', 'contact.created', 'contact.merged', 'contact.updated'].sort(),
    );
  });

  it('registers on the same queue, only when it is configured', () => {
    const consumer = { registerHandler: jest.fn() };
    const contacts = {};
    delete process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;
    new CallContactEventsHandler(contacts as never, consumer as never).onModuleInit();
    expect(consumer.registerHandler).not.toHaveBeenCalled();

    process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL = 'http://q';
    new CallContactEventsHandler(contacts as never, consumer as never).onModuleInit();
    expect(consumer.registerHandler).toHaveBeenCalledTimes(CALL_CONTACT_EVENT_TYPES.length);
  });

  it('a created or edited contact is forgotten', async () => {
    const { handler, contacts } = make();
    await handler.handle('contact.created', { contactId: 'c1' });
    await handler.handle('contact.updated', { contactId: 'c2' });
    expect(contacts.forgetContact.mock.calls).toEqual([['c1'], ['c2']]);
  });

  it('a merge forgets both sides', async () => {
    const { handler, contacts } = make();
    await handler.handle('contact.merged', { oldContactId: 'c1', newContactId: 'c2' });
    expect(contacts.forgetContact.mock.calls).toEqual([['c1'], ['c2']]);
  });

  it('a company is forgotten by id', async () => {
    const { handler, contacts } = make();
    await handler.handle('company.updated', { companyId: 'co1' });
    expect(contacts.forgetCompany).toHaveBeenCalledWith('co1');
  });

  it('never throws — a cache that could not be cleared expires on its own', async () => {
    const { handler, contacts } = make();
    contacts.forgetContact.mockRejectedValueOnce(new Error('crm down'));
    await expect(handler.handle('contact.updated', { contactId: 'c1' })).resolves.toBeUndefined();
  });
});
