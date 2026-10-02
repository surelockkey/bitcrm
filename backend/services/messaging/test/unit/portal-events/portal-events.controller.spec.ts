import 'reflect-metadata';
import { GUARDS_METADATA, HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IS_PUBLIC_KEY } from '@bitcrm/shared';
import { InternalGuard } from '../../../src/common/guards/internal.guard';
import { PortalEventsController } from '../../../src/outbound/portal-events.controller';
import { PortalEventDto } from '../../../src/outbound/dto/portal-event.dto';
import { type SendService } from '../../../src/outbound/send.service';

describe('PortalEventsController — billing tells the thread what the client did', () => {
  it('is an internal POST at internal/portal-events (service secret, no user token), answering 201', () => {
    const handler = PortalEventsController.prototype.record;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('internal/portal-events');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(InternalGuard);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBeUndefined();
  });

  it('hands the event to the service and answers whether a line was written', async () => {
    const recordPortalEvent = jest.fn().mockResolvedValue({ message: { id: 'm1' }, duplicate: false });
    const controller = new PortalEventsController({ recordPortalEvent } as unknown as SendService);
    const dto = { contactId: 'ct1', event: 'viewed', document: { kind: 'estimate', id: 'e1', number: 'K-1' }, eventKey: 'k' } as PortalEventDto;
    expect(await controller.record(dto)).toEqual({ success: true, data: { messageId: 'm1', duplicate: false } });
    expect(recordPortalEvent).toHaveBeenCalledWith(dto);
  });

  it('validates the event: a known kind, a document, a key', () => {
    const ok = plainToInstance(PortalEventDto, {
      contactId: 'ct1', event: 'payment', document: { kind: 'invoice', id: 'i1', number: 'N1' }, amount: 12.5, eventKey: 'payment:p1',
    });
    expect(validateSync(ok)).toEqual([]);
    const bad = plainToInstance(PortalEventDto, { contactId: 'ct1', event: 'hacked', document: { kind: 'receipt', id: 'i1' }, eventKey: '' });
    const fields = validateSync(bad).map((e) => e.property).sort();
    expect(fields).toEqual(['document', 'event', 'eventKey']);
  });
});
