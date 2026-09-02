import {
  EXTERNAL_COMPANIES_SEED,
  planExternalCompanySeed,
} from 'src/scripts/external-companies.catalog';

describe('external-companies seed catalog', () => {
  it('carries every company from the legacy list', () => {
    expect(EXTERNAL_COMPANIES_SEED).toHaveLength(33);
    const names = EXTERNAL_COMPANIES_SEED.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      'Agero',
      'Allied Dispatch Solutions',
      'American Services IL',
      'YIGAL dr locks stamford',
      'Yelp',
    ]));
  });

  it('keeps every name unique (case-insensitively)', () => {
    const lower = EXTERNAL_COMPANIES_SEED.map((c) => c.name.trim().toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });

  it('carries the contact details verbatim where the legacy list had them', () => {
    const allied = EXTERNAL_COMPANIES_SEED.find((c) => c.name === 'Allied Dispatch Solutions')!;
    expect(allied).toMatchObject({
      email: 'Tammy.Killen@allieddispatch.com',
      address: '500 Borla Dr, Johnson City, TN 37604',
      phone: '(855) 281-0219',
      active: false,
    });

    const american = EXTERNAL_COMPANIES_SEED.find((c) => c.name === 'American Services IL')!;
    expect(american).toMatchObject({ phone: '(630) 626-3992', active: true });
    expect(american.email).toBeUndefined();
    expect(american.address).toBeUndefined();
  });

  it('strips the stray mailto: prefixes the legacy export carried', () => {
    const az = EXTERNAL_COMPANIES_SEED.find((c) => c.name === 'AZ SHI ALI')!;
    expect(az.email).toBe('shaiprego@gmail.com');
    const mandel = EXTERNAL_COMPANIES_SEED.find((c) => c.name === 'MANDEL AZ')!;
    expect(mandel.email).toBe('Mendelbeck@gmail.com');
    expect(EXTERNAL_COMPANIES_SEED.some((c) => (c.email ?? '').includes('mailto:'))).toBe(false);
  });

  it('preserves the Enabled/Disabled state of the legacy list', () => {
    const enabled = EXTERNAL_COMPANIES_SEED.filter((c) => c.active).map((c) => c.name);
    expect(enabled).toEqual([
      'American Services IL',
      'Costco David',
      'IRBID LOCKSMITH',
      'MANDEL AZ',
      'Omri Lipmen',
      'Papas Lock Out Service',
      'Protech Office FL',
      'YAKIR NATAN',
      'YIGAL dr locks stamford',
    ]);
  });
});

describe('planExternalCompanySeed', () => {
  it('plans every company for an empty catalog, with ids and timestamps', () => {
    const plan = planExternalCompanySeed([]);
    expect(plan).toHaveLength(EXTERNAL_COMPANIES_SEED.length);
    expect(plan[0].id).toBeDefined();
    expect(plan[0].createdBy).toBe('external-companies-seed');
    expect(plan[0].createdAt).toBe(plan[0].updatedAt);
  });

  it('skips names already in the catalog, case-insensitively (idempotent re-run)', () => {
    const plan = planExternalCompanySeed(['  agero ', 'YELP']);
    const names = plan.map((c) => c.name);
    expect(names).not.toContain('Agero');
    expect(names).not.toContain('Yelp');
    expect(plan).toHaveLength(EXTERNAL_COMPANIES_SEED.length - 2);
  });

  it('plans nothing when everything is already seeded', () => {
    expect(planExternalCompanySeed(EXTERNAL_COMPANIES_SEED.map((c) => c.name))).toEqual([]);
  });

  it('omits blank contact fields rather than storing empty strings', () => {
    const agero = planExternalCompanySeed([]).find((c) => c.name === 'Agero')!;
    expect(agero.email).toBeUndefined();
    expect(agero.phone).toBeUndefined();
    expect(agero.address).toBeUndefined();
  });
});
