/**
 * Index settings + mappings. `title`/`keywords` use an edge-ngram index analyzer
 * (search-as-you-type prefix matching) with a standard search analyzer so a query
 * like "ac" matches "Acme". Authorization/facet fields are keyword (exact).
 */
export const INDEX_BODY = {
  settings: {
    analysis: {
      filter: {
        edge_ngram_filter: {
          type: 'edge_ngram',
          min_gram: 2,
          max_gram: 20,
        },
      },
      analyzer: {
        edge_ngram_analyzer: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase', 'edge_ngram_filter'],
        },
        standard_lowercase: {
          type: 'custom',
          tokenizer: 'standard',
          filter: ['lowercase'],
        },
      },
    },
  },
  mappings: {
    properties: {
      docId: { type: 'keyword' },
      entityId: { type: 'keyword' },
      type: { type: 'keyword' },

      // authorization / faceting
      permissionResource: { type: 'keyword' },
      ownerIds: { type: 'keyword' },
      department: { type: 'keyword' },
      status: { type: 'keyword' },

      // searchable text — ngram indexed, standard searched
      title: {
        type: 'text',
        analyzer: 'edge_ngram_analyzer',
        search_analyzer: 'standard_lowercase',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      subtitle: {
        type: 'text',
        analyzer: 'standard_lowercase',
      },
      keywords: {
        type: 'text',
        analyzer: 'edge_ngram_analyzer',
        search_analyzer: 'standard_lowercase',
        fields: { keyword: { type: 'keyword', ignore_above: 256 } },
      },
      body: { type: 'text', analyzer: 'standard_lowercase' },

      // display + ranking
      url: { type: 'keyword', index: false },
      badges: { type: 'keyword' },
      updatedAt: { type: 'date' },
    },
  },
};
