import { DomainEventsService } from '../../../src/api/common/domain-events.service';

describe('DomainEventsService', () => {
  const env = process.env;
  afterEach(() => {
    process.env = env;
  });

  it('publishes conversation.updated on message-events with the typed payload', async () => {
    process.env = { ...env, MESSAGE_EVENTS_TOPIC_ARN: 'arn:aws:sns:us-east-1:1:message-events' };
    const sns = { publish: jest.fn().mockResolvedValue(undefined) };
    const metrics = { eventsPublished: { inc: jest.fn() }, eventsFailed: { inc: jest.fn() } };
    new DomainEventsService(sns as never, metrics as never).conversationUpdated('c1');
    expect(sns.publish).toHaveBeenCalledWith('message-events', 'conversation.updated', { conversationId: 'c1' });
    await new Promise((r) => setImmediate(r));
    expect(metrics.eventsPublished.inc).toHaveBeenCalledWith({ event_type: 'conversation.updated' });
  });

  it('stays silent without a topic ARN, and without a publisher', () => {
    process.env = { ...env, MESSAGE_EVENTS_TOPIC_ARN: '' };
    const sns = { publish: jest.fn() };
    new DomainEventsService(sns as never).conversationUpdated('c1');
    expect(sns.publish).not.toHaveBeenCalled();
    expect(() => new DomainEventsService().conversationUpdated('c1')).not.toThrow();
  });

  it('a failed publish is logged and counted, never thrown', async () => {
    process.env = { ...env, MESSAGE_EVENTS_TOPIC_ARN: 'arn' };
    const sns = { publish: jest.fn().mockRejectedValue(new Error('sns down')) };
    const metrics = { eventsPublished: { inc: jest.fn() }, eventsFailed: { inc: jest.fn() } };
    expect(() => new DomainEventsService(sns as never, metrics as never).conversationUpdated('c1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(metrics.eventsFailed.inc).toHaveBeenCalledWith({ event_type: 'conversation.updated' });
  });
});
