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
