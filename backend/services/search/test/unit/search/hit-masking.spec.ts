import { SearchResponse } from '@bitcrm/types';
import { MASKED_CONVERSATION_TITLE, maskHit, maskSearchResponse } from 'src/search/hit-masking';

const numberThread = { entityId: 'cv1', type: 'conversation' as const, title: '+14045551234', badges: [], score: 1 };
const namedThread = { entityId: 'cv2', type: 'conversation' as const, title: 'John Smith', subtitle: 'call me at 404 555 1234', badges: [], score: 1 };
const contact = { entityId: 'c1', type: 'contact' as const, title: '+14045551234', badges: [], score: 1 };

describe('maskHit', () => {
  it('withholds a number-only conversation title from a viewer without contacts.view_numbers', () => {
    expect(maskHit(numberThread, false).title).toBe(MASKED_CONVERSATION_TITLE);
    expect(maskHit(numberThread, true).title).toBe('+14045551234');
  });

  it('leaves names, previews and other document types alone', () => {
    expect(maskHit(namedThread, false)).toBe(namedThread);
    expect(maskHit(contact, false)).toBe(contact);
  });

  it('never mutates the hit it was given', () => {
    const masked = maskHit(numberThread, false);
    expect(masked).not.toBe(numberThread);
    expect(numberThread.title).toBe('+14045551234');
  });
});

describe('maskSearchResponse', () => {
  const response: SearchResponse = {
    query: '404',
    mode: 'full',
    groups: [{ type: 'conversation', total: 2, items: [numberThread, namedThread] }],
    hits: [numberThread, contact],
    took: 1,
  };

  it('masks typeahead groups and full-mode hits alike', () => {
    const masked = maskSearchResponse(response, false);
    expect(masked.groups[0].items.map((h) => h.title)).toEqual([MASKED_CONVERSATION_TITLE, 'John Smith']);
    expect(masked.hits!.map((h) => h.title)).toEqual([MASKED_CONVERSATION_TITLE, '+14045551234']);
  });

  it('returns the response untouched for an allowed viewer', () => {
    expect(maskSearchResponse(response, true)).toBe(response);
  });
});
