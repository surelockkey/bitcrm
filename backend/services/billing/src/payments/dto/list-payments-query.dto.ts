import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { PAYMENT_METHODS, PAYMENT_STATUSES, type PaymentMethod, type PaymentStatus } from '@bitcrm/types';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListPaymentsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Inclusive lower bound on the payment date.' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiPropertyOptional({ enum: PAYMENT_METHODS as unknown as string[] })
  @IsOptional()
  @IsIn(PAYMENT_METHODS as unknown as string[])
  method?: PaymentMethod;

  @ApiPropertyOptional({ enum: PAYMENT_STATUSES as unknown as string[] })
  @IsOptional()
  @IsIn(PAYMENT_STATUSES as unknown as string[])
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: "One client's payment history." })
  @IsOptional()
  @IsString()
  contactId?: string;
}
