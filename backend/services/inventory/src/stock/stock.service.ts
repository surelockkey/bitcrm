import { Injectable } from '@nestjs/common';
import { type TransferItem } from '@bitcrm/types';
import { DynamoDbService } from '@bitcrm/shared';
import { StockRepository } from './stock.repository';

@Injectable()
export class StockService {
  constructor(
    private readonly stockRepository: StockRepository,
    private readonly dynamoDb: DynamoDbService,
  ) {}

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
    for (const item of items) {
      await this.stockRepository.decrementStock(
        fromPK,
        item.productId,
        item.quantity,
      );
    }
  }

  /**
   * One atomic move per item: the source and destination rows change together,
   * or not at all. Insufficient stock at the source stops the list there.
   */
  async transfer(
    fromPK: string,
    toPK: string,
    items: TransferItem[],
  ): Promise<void> {
    for (const item of items) {
      await this.stockRepository.moveStock(
        fromPK,
        toPK,
        item.productId,
        item.productName,
        item.quantity,
      );
    }
  }
}
