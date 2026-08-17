import {
  WORKIZ_FIELDS,
  planWorkizSeed,
} from 'src/scripts/workiz-fields.catalog';

describe('Workiz custom-field seed catalog', () => {
  it('covers every field from the Workiz screenshots, grouped as there', () => {
    const byGroup = (g: string) =>
      WORKIZ_FIELDS.filter((f) => f.group === g).map((f) => f.name);

    expect(byGroup('Other Contact')).toEqual(['Additional number', 'Additional number 2']);
    expect(byGroup('Dispatchers')).toEqual([
      'Manager Note',
      'Searchable number',
      'Searchable number 2',
    ]);
    expect(byGroup('Tech')).toEqual([
      'Check Image Front',
      'Check Image Back',
      'Tech Parts cost',
      'Company Parts cost',
      'Parts Image',
      'After Job Image',
      'Before Job Image',
    ]);
    expect(byGroup('Platinum')).toEqual([
      'WO File',
      'Vendor N',
      'C PO',
      'VPO',
      'WO SERVICE DESCRIPTION',
      'Picture Before After',
      'Work Order Link',
    ]);
    expect(byGroup('Company')).toEqual(['Choose Company']);
    expect(byGroup('Need To Order')).toEqual(['Item to be ordered', 'Quantity']);
    expect(byGroup('Extra Info')).toEqual([
      'Jobs Dispatch',
      'Dispatchers ID UA',
      'Dispatchers ID GE',
    ]);
    expect(WORKIZ_FIELDS).toHaveLength(25);
  });

  it('types match the Workiz catalog (files, numbers, large text, dropdowns)', () => {
    const type = (name: string) => WORKIZ_FIELDS.find((f) => f.name === name)?.type;

    expect(type('Check Image Front')).toBe('file');
    expect(type('Manager Note')).toBe('large_text');
    expect(type('Tech Parts cost')).toBe('number');
    expect(type('Additional number')).toBe('number');
    expect(type('Vendor N')).toBe('text');
    expect(type('Choose Company')).toBe('dropdown');
    expect(type('Jobs Dispatch')).toBe('dropdown');
    expect(type('Quantity')).toBe('number');
  });

  it('marks only the two searchable numbers as searchable', () => {
    const searchable = WORKIZ_FIELDS.filter((f) => f.searchable).map((f) => f.name);
    expect(searchable).toEqual(['Searchable number', 'Searchable number 2']);
  });

  it('gives dropdowns an empty options list to fill in Settings later', () => {
    for (const f of WORKIZ_FIELDS.filter((x) => x.type === 'dropdown')) {
      expect(f.options).toEqual([]);
    }
  });

  it('plans only the fields that do not already exist (case-insensitive)', () => {
    const plan = planWorkizSeed(['manager note', 'VENDOR N', 'Something unrelated']);

    const names = plan.map((f) => f.name);
    expect(names).not.toContain('Manager Note');
    expect(names).not.toContain('Vendor N');
    expect(names).toContain('Check Image Front');
    expect(plan).toHaveLength(23);
  });

  it('orders fields inside a group by descending priority (screenshot order)', () => {
    const tech = planWorkizSeed([]).filter((f) => f.group === 'Tech');
    const priorities = tech.map((f) => f.priority);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
    expect(new Set(priorities).size).toBe(priorities.length);
  });
});
