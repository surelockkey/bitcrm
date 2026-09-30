/** True for the failure a conditional write deliberately provokes. */
export function isConditionalCheckFailed(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'ConditionalCheckFailedException';
}

export function isTransactionCanceled(err: unknown): boolean {
  return (err as { name?: string } | undefined)?.name === 'TransactionCanceledException';
}
