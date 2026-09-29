/**
 * `POST /crm/contacts/internal/names-by-ids` — an internal caller (deal-service
 * side-loading the clients of a page of jobs) turns contact ids into names.
 *
 * The point of these tests is the *shape*: names only. crm masks a contact's
 * numbers per caller via `contacts.view_numbers`, and an internal route has no
 * caller to mask for, so anything it returns is effectively unmasked. Hence
 * the assertions below that a phone which exists on the fixture never reaches
 * the response.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ContactsController } from 'src/contacts/contacts.controller';
import { LookupContactNamesByIdsDto } from 'src/contacts/dto/lookup-contact-names-by-ids.dto';
import { createMockContact } from '../mocks';

const errorsOf = async (dto: object) =>
  (await validate(plainToInstance(LookupContactNamesByIdsDto, dto))).flatMap((e) =>
    Object.values(e.constraints ?? {}),
  );

describe('ContactsController.findNamesByIdsInternal', () => {
  it('returns id, firstName and lastName — and nothing else', async () => {
    const contact = createMockContact({
      id: 'c-1',
      firstName: 'Jane',
      lastName: 'Roe',
      phones: ['+14045551234'],
      emails: ['jane@example.com'],
    });
    const service = { findByIds: jest.fn().mockResolvedValue([contact]) };
    const controller = new ContactsController(service as any);

    const res = await controller.findNamesByIdsInternal({ ids: ['c-1'] });

    expect(service.findByIds).toHaveBeenCalledWith(['c-1']);
    expect(res).toEqual({
      success: true,
      data: [{ id: 'c-1', firstName: 'Jane', lastName: 'Roe' }],
    });
    // The fixture has a phone and an email; neither may ride along.
    expect(Object.keys(res.data[0]).sort()).toEqual(['firstName', 'id', 'lastName']);
    expect(JSON.stringify(res.data)).not.toContain('+14045551234');
    expect(JSON.stringify(res.data)).not.toContain('jane@example.com');
  });

  it('leaves an id that no longer exists out rather than erroring', async () => {
    const service = {
      findByIds: jest.fn().mockResolvedValue([createMockContact({ id: 'c-1' })]),
    };
    const controller = new ContactsController(service as any);

    const res = await controller.findNamesByIdsInternal({ ids: ['c-1', 'gone'] });

    expect(res.success).toBe(true);
    expect(res.data.map((p) => p.id)).toEqual(['c-1']);
  });

  it('answers an empty list for ids nobody owns', async () => {
    const service = { findByIds: jest.fn().mockResolvedValue([]) };
    const controller = new ContactsController(service as any);

    expect(await controller.findNamesByIdsInternal({ ids: ['gone'] })).toEqual({
      success: true,
      data: [],
    });
  });
});

describe('LookupContactNamesByIdsDto', () => {
  it('accepts a full page of 100 ids', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `c-${i}`);
    expect(await errorsOf({ ids })).toEqual([]);
  });

  it('caps the batch at 100 ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `c-${i}`);
    expect(await errorsOf({ ids })).toEqual(
      expect.arrayContaining([expect.stringContaining('100')]),
    );
  });

  it('rejects an empty batch and non-string ids', async () => {
    expect((await errorsOf({ ids: [] })).length).toBeGreaterThan(0);
    expect((await errorsOf({ ids: [42] })).length).toBeGreaterThan(0);
  });
});
