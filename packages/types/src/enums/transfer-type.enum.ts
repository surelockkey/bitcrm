export enum TransferType {
  RECEIVE = 'receive',
  TRANSFER = 'transfer',
  DEDUCT = 'deduct',
  RESTORE = 'restore',
  /** Stock leaves a location without a job: recalled, damaged or lost. */
  RETURN = 'return',
}

export enum LocationType {
  SUPPLIER = 'supplier',
  WAREHOUSE = 'warehouse',
  CONTAINER = 'container',
}
