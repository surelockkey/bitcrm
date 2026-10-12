import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateItemGroupDto } from 'src/item-groups/dto/create-item-group.dto';
import { UpdateItemGroupDto } from 'src/item-groups/dto/update-item-group.dto';
import { ListItemGroupsQueryDto } from 'src/item-groups/dto/list-item-groups-query.dto';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errorsFor = async (cls: any, payload: unknown) =>
  (await validate(plainToInstance(cls, payload))).map((e) => e.property);

/** The nested error paths, "members.0.quantity". */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deepErrors = async (cls: any, payload: unknown) => {
  const out: string[] = [];
  const walk = (errors: Awaited<ReturnType<typeof validate>>, prefix: string) => {
    for (const e of errors) {
      const path = prefix ? `${prefix}.${e.property}` : e.property;
      if (e.children?.length) walk(e.children, path);
      else out.push(path);
    }
  };
  walk(await validate(plainToInstance(cls, payload)), '');
  return out;
};

const member = { productId: 'prod-1', quantity: 1, priceClient: 45 };

describe('CreateItemGroupDto', () => {
  it('takes a name and its items; the rest is optional', async () => {
    expect(await errorsFor(CreateItemGroupDto, { name: 'Storm door', members: [member] })).toEqual([]);
    expect(
      await errorsFor(CreateItemGroupDto, {
        name: 'Storm door',
        description: 'Door + labor',
        categoryId: 'cat-1',
        active: false,
        members: [
          {
            ...member,
            name: 'Service Call Fee',
            description: 'Trip',
            cost: 0,
            taxable: false,
            quantity: 1.5,
            customAttributes: { 'In Store Location': '8-B-8' },
          },
        ],
      }),
    ).toEqual([]);
  });

  it('trims the name and refuses a blank one', async () => {
    expect(plainToInstance(CreateItemGroupDto, { name: '  Metal Door  ', members: [member] }).name).toBe('Metal Door');
    expect(await errorsFor(CreateItemGroupDto, { name: '   ', members: [member] })).toEqual(['name']);
  });

  it('refuses a member without an item, with no quantity or a negative price', async () => {
    expect(await deepErrors(CreateItemGroupDto, { name: 'x', members: [{ quantity: 1, priceClient: 1 }] })).toEqual([
      'members.0.productId',
    ]);
    expect(await deepErrors(CreateItemGroupDto, { name: 'x', members: [{ ...member, quantity: 0 }] })).toEqual([
      'members.0.quantity',
    ]);
    expect(await deepErrors(CreateItemGroupDto, { name: 'x', members: [{ ...member, priceClient: -1 }] })).toEqual([
      'members.0.priceClient',
    ]);
    expect(await deepErrors(CreateItemGroupDto, { name: 'x', members: [{ ...member, cost: -1 }] })).toEqual([
      'members.0.cost',
    ]);
  });

  it('refuses members that are not a list, and custom field values that are not text', async () => {
    expect(await errorsFor(CreateItemGroupDto, { name: 'x', members: 'all' })).toEqual(['members']);
    expect(
      await deepErrors(CreateItemGroupDto, { name: 'x', members: [{ ...member, customAttributes: { Bin: 5 } }] }),
    ).toEqual(['members.0.customAttributes']);
  });

  it('caps a group at 100 items', async () => {
    const many = Array.from({ length: 101 }, () => member);
    expect(await errorsFor(CreateItemGroupDto, { name: 'x', members: many })).toEqual(['members']);
  });
});

describe('UpdateItemGroupDto', () => {
  it('every field is optional; an empty category clears it', async () => {
    expect(await errorsFor(UpdateItemGroupDto, {})).toEqual([]);
    expect(await errorsFor(UpdateItemGroupDto, { active: false })).toEqual([]);
    expect(await errorsFor(UpdateItemGroupDto, { categoryId: '' })).toEqual([]);
    expect(await errorsFor(UpdateItemGroupDto, { members: [member] })).toEqual([]);
  });

  it('a rename to a blank name is refused, and a non-boolean status too', async () => {
    expect(await errorsFor(UpdateItemGroupDto, { name: ' ' })).toEqual(['name']);
    expect(await errorsFor(UpdateItemGroupDto, { active: 'no' })).toEqual(['active']);
  });
});

describe('ListItemGroupsQueryDto', () => {
  it("takes Workiz's status box — active, disabled or all — or nothing", async () => {
    for (const status of ['active', 'disabled', 'all', undefined]) {
      expect(await errorsFor(ListItemGroupsQueryDto, { status })).toEqual([]);
    }
    expect(await errorsFor(ListItemGroupsQueryDto, { status: 'archived' })).toEqual(['status']);
  });
});
