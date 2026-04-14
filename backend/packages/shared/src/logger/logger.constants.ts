/** Paths to redact from logs — values at these paths are replaced with '[REDACTED]' */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.refreshToken',
  'req.body.session',
];

/** Header name used to propagate trace IDs across services */
export const TRACE_ID_HEADER = 'x-trace-id';

/** SNS message attribute key for trace ID */
export const TRACE_ID_ATTRIBUTE = 'traceId';
