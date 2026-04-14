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

  async transfer(
    fromPK: string,
    toPK: string,
    items: TransferItem[],
  ): Promise<void> {
    // Decrement source first, then increment destination
    // If decrement fails (insufficient stock), increment won't happen
    for (const item of items) {
      await this.stockRepository.decrementStock(
        fromPK,
        item.productId,
        item.quantity,
      );
      await this.stockRepository.incrementStock(
        toPK,
        item.productId,
        item.productName,
        item.quantity,
      );
    }
  }
}
