/** Helpers for the two DynamoDB failures the repositories deliberately provoke. */

export function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'ConditionalCheckFailedException';
}

export function isTransactionCanceled(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'TransactionCanceledException';
}

/**
 * Per-item cancellation codes of a TransactionCanceledException, in
 * TransactItems order — `None` for items that passed, `ConditionalCheckFailed`
 * for the guard that tripped.
 */
export function cancellationCodes(err: unknown): string[] {
  const reasons = (err as { CancellationReasons?: Array<{ Code?: string } | null> } | undefined)
    ?.CancellationReasons;
  return (reasons ?? []).map((r) => r?.Code ?? 'None');
}

/** True when a transaction was cancelled because item `index`'s condition failed. */
export function conditionFailedAt(err: unknown, index: number): boolean {
  return isTransactionCanceled(err) && cancellationCodes(err)[index] === 'ConditionalCheckFailed';
}

/**
 * The `ConditionalCheckFailedException` a bare `PutItem` with
 * `attribute_not_exists(PK)` raises on a duplicate key.
 *
 * A write that has to grow to a transaction — because a counters ADD now rides
 * with it — gets a `TransactionCanceledException` from DynamoDB instead. Where
 * the existence guard is the whole point of the call, the caller's contract
 * should not change with the number of items in the write, so the transaction
 * form is translated back into this.
 */
export function duplicateKeyError(id: string): Error {
  const err = new Error(`The conditional request failed (duplicate ${id})`);
  err.name = 'ConditionalCheckFailedException';
  return err;
}
