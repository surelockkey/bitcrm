/**
 * A client keeps every address it has (import decision B2, 2026-09-16).
 * Ten was never a business rule — it was a guess, and a Workiz client can
 * carry hundreds: 5 hold more than 200, the largest about 1 016. The only
 * real ceiling is DynamoDB's 400 KB item, so the cap is a byte budget the
 * caller is told about, not a round number.
 */
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateContactDto, MAX_CONTACT_ADDRESSES } from 'src/contacts/dto/create-contact.dto';
import { UpdateContactDto } from 'src/contacts/dto/update-contact.dto';

const address = (n: number) => ({
  street: `${n} Main St`,
  city: 'Atlanta',
  state: 'GA',
  zip: '30303',
});

const base = {
  firstName: 'CBRE',
  lastName: 'Facilities',
  phones: ['(404) 555-1234'],
  type: 'company_representative',
  source: 'manual',
};

const errorsOf = async (dto: object, cls: typeof CreateContactDto | typeof UpdateContactDto) =>
  (await validate(plainToInstance(cls, dto))).flatMap((e) => Object.values(e.constraints ?? {}));

describe('a contact carries every address it has', () => {
  it('the cap leaves room for the largest client known and then some', () => {
    expect(MAX_CONTACT_ADDRESSES).toBeGreaterThanOrEqual(1100);
  });

  it('accepts far more than ten on create', async () => {
    const addresses = Array.from({ length: 1016 }, (_, i) => address(i));
    expect(await errorsOf({ ...base, addresses }, CreateContactDto)).toEqual([]);
  });

  it('accepts far more than ten on update', async () => {
    const addresses = Array.from({ length: 1016 }, (_, i) => address(i));
    expect(await errorsOf({ addresses }, UpdateContactDto)).toEqual([]);
  });

  it('refuses a list so long the record could not be stored, and says why', async () => {
    const addresses = Array.from({ length: MAX_CONTACT_ADDRESSES + 1 }, (_, i) => address(i));
    const messages = await errorsOf({ ...base, addresses }, CreateContactDto);
    expect(messages.join(' ')).toMatch(/address/i);
    expect(messages.length).toBeGreaterThan(0);
  });

  it('a contact with no addresses is still fine', async () => {
    expect(await errorsOf({ ...base }, CreateContactDto)).toEqual([]);
  });
});
