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

      // client references (deal docs) — reindex fan-out when a client changes
      contactId: { type: 'keyword' },
      companyId: { type: 'keyword' },

      // conversation docs (messaging design §7.4) — facets + reindex fan-out:
      // partyKind/partyId when the party is edited, dealIds when a job's roster changes
      conversationKind: { type: 'keyword' },
      conversationState: { type: 'keyword' },
      partyKind: { type: 'keyword' },
      partyId: { type: 'keyword' },
      assignedUserId: { type: 'keyword' },
      flagged: { type: 'boolean' },
      lastMessageAt: { type: 'date' },
      dealIds: { type: 'keyword' },

      // product docs only — the Price Book list inventory reads instead of
      // walking its PRODUCTS#ALL partition (`product-list/`). Exact fields:
      // every filter is a term, the search a wildcard on the lowercased name /
      // SKU (DynamoDB's `contains`), and the two sort keys are byte-for-byte
      // the GSI4SK / GSI3SK of the inventory rows, so a cursor is good on both.
      productList: {
        properties: {
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
        },
      },

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
