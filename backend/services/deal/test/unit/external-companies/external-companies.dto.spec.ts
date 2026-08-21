import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExternalCompanyDto } from 'src/external-companies/dto/create-external-company.dto';
import { UpdateExternalCompanyDto } from 'src/external-companies/dto/update-external-company.dto';

const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

describe('CreateExternalCompanyDto', () => {
  it('accepts a company with no contact details at all', async () => {
    // The settings form sends "" for every untouched field — most of the
    // legacy list has blank email/address/phone, so this is the common case.
    expect(
      await errorsFor(CreateExternalCompanyDto, {
        name: 'Agero',
        email: '',
        address: '',
        phone: '',
        active: true,
      }),
    ).toEqual([]);
  });

  it('accepts a fully-populated company', async () => {
    expect(
      await errorsFor(CreateExternalCompanyDto, {
        name: 'Allied Dispatch Solutions',
        email: 'Tammy.Killen@allieddispatch.com',
        address: '500 Borla Dr, Johnson City, TN 37604',
        phone: '(855) 281-0219',
        active: false,
      }),
    ).toEqual([]);
  });

  it('still rejects a malformed email', async () => {
    expect(await errorsFor(CreateExternalCompanyDto, { name: 'BNG', email: 'nope' })).toEqual([
      'email',
    ]);
  });

  it('rejects a blank name', async () => {
    expect(await errorsFor(CreateExternalCompanyDto, { name: '   ' })).toEqual(['name']);
  });
});

describe('UpdateExternalCompanyDto', () => {
  it('accepts empty strings, which clear the contact fields', async () => {
    expect(
      await errorsFor(UpdateExternalCompanyDto, { email: '', address: '', phone: '' }),
    ).toEqual([]);
  });

  it('accepts a lone active toggle (the list\'s Disable/Enable action)', async () => {
    expect(await errorsFor(UpdateExternalCompanyDto, { active: false })).toEqual([]);
  });

  it('rejects a malformed email on update too', async () => {
    expect(await errorsFor(UpdateExternalCompanyDto, { email: 'nope' })).toEqual(['email']);
  });
});
