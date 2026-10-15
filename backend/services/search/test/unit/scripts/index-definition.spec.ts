import { INDEX_BODY } from 'src/scripts/index-definition';
import { SEARCH_INDEX_NAME } from 'src/common/constants/opensearch.constants';

describe('index definition', () => {
  const props = INDEX_BODY.mappings.properties as unknown as Record<string, { type: string }>;

  it('maps the conversation facets as exact fields (filters and reindex fan-out)', () => {
    expect(props.conversationKind).toEqual({ type: 'keyword' });
    expect(props.conversationState).toEqual({ type: 'keyword' });
    expect(props.partyKind).toEqual({ type: 'keyword' });
    expect(props.partyId).toEqual({ type: 'keyword' });
    expect(props.assignedUserId).toEqual({ type: 'keyword' });
    expect(props.flagged).toEqual({ type: 'boolean' });
    expect(props.lastMessageAt).toEqual({ type: 'date' });
    expect(props.dealIds).toEqual({ type: 'keyword' });
  });

  it('maps the Price Book list fields on product docs as exact, sortable fields (v4)', () => {
    const list = (props as any).productList;
    expect(list.type).toBeUndefined(); // an object field
    expect(list.properties).toEqual({
      productType: { type: 'keyword' },
      status: { type: 'keyword' },
      brandId: { type: 'keyword' },
      manageStock: { type: 'boolean' },
      stockManaged: { type: 'boolean' },
      stockLevel: { type: 'keyword' },
      searchName: { type: 'keyword' },
      searchSku: { type: 'keyword' },
      catalogSort: { type: 'keyword' },
      stockSort: { type: 'keyword' },
    });
  });

  // Phone numbers are matched as whole digit strings — never edge-ngram
  // fragments, never fuzzily — so a number finds exactly the records that carry it.
  it('maps the phone digit variants as an exact, unanalysed field (v5)', () => {
    expect(props.phoneDigits).toEqual({ type: 'keyword' });
  });

  it('is versioned past v4 because the mapping grew (phoneDigits)', () => {
    expect(SEARCH_INDEX_NAME).toBe('bitcrm-search-v5');
  });
});
