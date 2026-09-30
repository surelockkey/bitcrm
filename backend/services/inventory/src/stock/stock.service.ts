import { Injectable, Logger } from '@nestjs/common';
import { type TransferItem } from '@bitcrm/types';
import { DynamoDbService } from '@bitcrm/shared';
import { StockRepository } from './stock.repository';

/**
 * Multi-item stock movements. Each item is its own write (a move is one
 * TransactWrite per item), so a movement that fails on item k has already
 * moved items 1..k-1 — with no journal row and no log, because the caller
 * records only after the whole list moved. A failed movement must move
 * nothing: the items that went through are undone in reverse order, best
 * effort (an undo that fails is logged loudly and the rest are still undone),
 * and the original error is rethrown.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(
    private readonly stockRepository: StockRepository,
    private readonly dynamoDb: DynamoDbService,
  ) {}

  /**
   * Increments have no condition, so an item fails here only on an
   * infrastructure error; nothing is undone (an undo would be a conditional
   * decrement that could fail the same way).
   */
  async receive(
    toPK: string,
    items: TransferItem[],
  ): Promise<void> {
    for (const item of items) {
      await this.stockRepository.incrementStock(
        toPK,
        item.productId,
        item.productName,
        item.quantity,
      );
    }
  }

  async deduct(
    fromPK: string,
    items: TransferItem[],
  ): Promise<void> {
    await this.allOrNothing(
      items,
      (item) => this.stockRepository.decrementStock(fromPK, item.productId, item.quantity),
      (item) =>
        this.stockRepository.incrementStock(fromPK, item.productId, item.productName, item.quantity),
      `deduct from ${fromPK}`,
    );
  }

  /**
   * One atomic move per item: the source and destination rows change together,
   * or not at all. Insufficient stock at the source stops the list there and
   * moves the earlier items back.
   */
  async transfer(
    fromPK: string,
    toPK: string,
    items: TransferItem[],
  ): Promise<void> {
    await this.allOrNothing(
      items,
      (item) =>
        this.stockRepository.moveStock(fromPK, toPK, item.productId, item.productName, item.quantity),
      (item) =>
        this.stockRepository.moveStock(toPK, fromPK, item.productId, item.productName, item.quantity),
      `transfer ${fromPK} -> ${toPK}`,
    );
  }

  private async allOrNothing(
    items: TransferItem[],
    apply: (item: TransferItem) => Promise<void>,
    undo: (item: TransferItem) => Promise<void>,
    what: string,
  ): Promise<void> {
    const done: TransferItem[] = [];
    try {
      for (const item of items) {
        await apply(item);
        done.push(item);
      }
    } catch (error: unknown) {
      for (const item of done.reverse()) {
        try {
          await undo(item);
        } catch (undoError: unknown) {
          this.logger.error(
            `STOCK OUT OF STEP: could not undo ${item.quantity} × ${item.productId} of a failed ` +
              `${what}: ${(undoError as Error).message}. Fix that stock row by hand.`,
          );
        }
      }
      throw error;
    }
  }
}
