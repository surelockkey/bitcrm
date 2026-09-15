import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvalidCursorError } from '../../common/cursor';
import {
  StaleConversationError,
  UnsupportedInboxFilterError,
} from '../../conversations/conversations.repository';

/**
 * Repository errors the client caused, translated at the service boundary so
 * controllers stay thin: a bad cursor or an unindexed filter is a 400, a lost
 * optimistic-guard race is a 409 the client retries after re-reading.
 */
export function toHttpError(err: unknown): unknown {
  if (err instanceof InvalidCursorError) return new BadRequestException(err.message);
  if (err instanceof UnsupportedInboxFilterError) return new BadRequestException(err.message);
  if (err instanceof StaleConversationError) {
    return new ConflictException('Conversation changed underneath the update; re-read and retry');
  }
  return err;
}

/** `await withHttpErrors(() => repo.call())` */
export async function withHttpErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toHttpError(err);
  }
}
