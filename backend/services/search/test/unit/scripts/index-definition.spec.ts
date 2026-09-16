import { INDEX_BODY } from 'src/scripts/index-definition';
import { SEARCH_INDEX_NAME } from 'src/common/constants/opensearch.constants';

describe('index definition', () => {
  const props = INDEX_BODY.mappings.properties as Record<string, { type: string }>;

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

  it('is versioned past v2 because the mapping grew', () => {
    expect(SEARCH_INDEX_NAME).toBe('bitcrm-search-v3');
  });
});
