import {
  BITCRM_NAMESPACE,
  bitcrmId,
  externalId,
  uuidV5,
} from '../../../../src/automations/translator/workiz-ids';

/**
 * These values are what the importer wrote into the table
 * (`workiz-data-parser/workiz/bitcrm/ids.py`, `uuid.uuid5`). If this file
 * ever goes red, either the namespace string changed — which would orphan
 * every imported row — or the uuid5 implementation drifted.
 */
describe('Workiz → BitCRM ids', () => {
  it('derives the same namespace uuid the importer uses', () => {
    const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidV5('https://bitcrm.tech-slk.com/workiz', NAMESPACE_URL)).toBe(BITCRM_NAMESPACE);
    expect(BITCRM_NAMESPACE).toBe('489d081e-d230-585d-9119-ad61d13edc16');
  });

  it('mints the ids the imported rows carry', () => {
    // Values checked against uuid.uuid5(BITCRM_NS, "<ns>:<id>") in Python.
    expect(bitcrmId('substatus', '14217')).toBe('3dc551de-e31c-5d0c-8896-5f45de2070cd');
    expect(bitcrmId('tag', 718269)).toBe('925baf75-607e-5b9f-aee6-c6d6f1f3368a');
    expect(bitcrmId('adgroup', '1192834')).toBe('11c6d7bc-2319-559a-9d40-165baa00a33c');
    expect(bitcrmId('jobtype', '13765')).toBe('03124662-fd2d-57a7-b8e6-b333aa7466dc');
    expect(bitcrmId('user', '270795')).toBe('4abed840-c613-5d32-810a-653249400af0');
  });

  it('is a valid v5 uuid and is stable across spellings of the same id', () => {
    const id = bitcrmId('tag', ' 718269 ');
    expect(id).toBe(bitcrmId('tag', 718269));
    expect(id[14]).toBe('5'); // version
    expect('89ab').toContain(id[19]); // RFC 4122 variant
  });

  it('spells the external id the way the importer does', () => {
    expect(externalId('substatus', '14217')).toBe('workiz:substatus:14217');
  });

  it('refuses a namespace that is not a uuid', () => {
    expect(() => uuidV5('x', 'not-a-uuid')).toThrow(/Not a uuid/);
  });
});
