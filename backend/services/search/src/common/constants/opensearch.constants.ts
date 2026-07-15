/** Alias the app reads/writes; concrete indices are versioned (bitcrm-search-v1…) behind it. */
export const SEARCH_INDEX_ALIAS = process.env.SEARCH_INDEX_ALIAS || 'bitcrm-search';

/** Concrete index name to (re)build; alias is swapped to point here. */
export const SEARCH_INDEX_NAME = process.env.SEARCH_INDEX_NAME || 'bitcrm-search-v1';

export const OPENSEARCH_ENDPOINT =
  process.env.OPENSEARCH_ENDPOINT || 'http://localhost:9200';

/**
 * OpenSearch Serverless (`aoss`) uses IAM SigV4 auth; a classic managed domain or
 * the local single-node container use basic/no auth. Controls how the client signs.
 */
export const OPENSEARCH_SERVERLESS = process.env.OPENSEARCH_SERVERLESS === 'true';

export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/** Field boosts for relevance (title matters most, body least). */
export const FIELD_BOOSTS = {
  title: 5,
  keywords: 3,
  subtitle: 2,
  body: 1,
} as const;
