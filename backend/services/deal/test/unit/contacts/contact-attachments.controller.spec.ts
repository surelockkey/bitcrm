import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSION_KEY } from '@bitcrm/shared';
import { DealsModule } from 'src/deals/deals.module';
import { DealsController } from 'src/deals/deals.controller';
import { ContactAttachmentsController } from 'src/contacts/contact-attachments.controller';
import { createMockJwtUser } from '../mocks';

/**
 * The client card's Files: `GET /deals/attachments/by-contact/:contactId` for
 * the list, and the client's own files under `/deals/contacts/:contactId/
 * attachments…` — writes behind `contacts.edit`, reads behind `contacts.view`,
 * the list behind `deals.view` like the job files it is mostly made of.
 */
describe('ContactAttachmentsController', () => {
  const service = {
    listByContact: jest.fn(),
    requestUpload: jest.fn(),
    getDownloadUrl: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new ContactAttachmentsController(service as never);
  const user = createMockJwtUser();

  beforeEach(() => Object.values(service).forEach((m) => m.mockReset()));

  it('is registered ahead of DealsController, or GET /:id/attachments would take /attachments/by-contact', () => {
    const controllers: unknown[] = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, DealsModule);
    expect(controllers.indexOf(ContactAttachmentsController)).toBeGreaterThanOrEqual(0);
    expect(controllers.indexOf(ContactAttachmentsController)).toBeLessThan(controllers.indexOf(DealsController));
  });

  it('routes and guards', () => {
    const route = (handler: unknown) => Reflect.getMetadata(PATH_METADATA, handler as object);
    const guard = (handler: unknown) => Reflect.getMetadata(PERMISSION_KEY, handler as object);
    expect(route(controller.listByContact)).toBe('attachments/by-contact/:contactId');
    expect(guard(controller.listByContact)).toEqual({ resource: 'deals', action: 'view' });
    expect(route(controller.requestUpload)).toBe('contacts/:contactId/attachments');
    expect(guard(controller.requestUpload)).toEqual({ resource: 'contacts', action: 'edit' });
    expect(route(controller.download)).toBe('contacts/:contactId/attachments/:attachmentId');
    expect(guard(controller.download)).toEqual({ resource: 'contacts', action: 'view' });
    expect(route(controller.update)).toBe('contacts/:contactId/attachments/:attachmentId');
    expect(guard(controller.update)).toEqual({ resource: 'contacts', action: 'edit' });
    expect(route(controller.remove)).toBe('contacts/:contactId/attachments/:attachmentId');
    expect(guard(controller.remove)).toEqual({ resource: 'contacts', action: 'edit' });
  });

  it('list: envelope with pagination, limit default 30 clamped to 1–100', async () => {
    service.listByContact.mockResolvedValue({ items: [{ id: 'a' }], nextCursor: 'n' });
    await expect(controller.listByContact('c1', undefined, undefined)).resolves.toEqual({
      success: true,
      data: [{ id: 'a' }],
      pagination: { nextCursor: 'n', count: 1 },
    });
    await controller.listByContact('c1', '0', 'cur');
    await controller.listByContact('c1', '999', undefined);
    expect(service.listByContact.mock.calls).toEqual([
      ['c1', 30, undefined],
      ['c1', 1, 'cur'],
      ['c1', 100, undefined],
    ]);
  });

  it('upload / download / update / delete delegate and wrap', async () => {
    const dto = { fileName: 'a.pdf', contentType: 'application/pdf' };
    service.requestUpload.mockResolvedValue({ id: 'x', uploadUrl: 'u', s3Key: 'k', headers: {} });
    await expect(controller.requestUpload('c1', dto as never, user)).resolves.toEqual({
      success: true,
      data: { id: 'x', uploadUrl: 'u', s3Key: 'k', headers: {} },
    });
    expect(service.requestUpload).toHaveBeenCalledWith('c1', dto, user);

    service.getDownloadUrl.mockResolvedValue({ downloadUrl: 'd' });
    await expect(controller.download('c1', 'x')).resolves.toEqual({ success: true, data: { downloadUrl: 'd' } });

    service.update.mockResolvedValue({ id: 'x', fileName: 'b.pdf' });
    await expect(controller.update('c1', 'x', { fileName: 'b.pdf' }, user)).resolves.toEqual({
      success: true,
      data: { id: 'x', fileName: 'b.pdf' },
    });
    expect(service.update).toHaveBeenCalledWith('c1', 'x', { fileName: 'b.pdf' }, user);

    await expect(controller.remove('c1', 'x', user)).resolves.toEqual({ success: true, data: null });
    expect(service.delete).toHaveBeenCalledWith('c1', 'x', user);
  });
});
