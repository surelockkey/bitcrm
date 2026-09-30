import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UsageJobDto } from '../../inventory-usage/dto/usage-job.dto';

class RestoreItemDto {
  @ApiProperty()
  @IsString()
  productId!: string;

  @ApiProperty()
  @IsString()
  productName!: string;

  @ApiProperty()
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: "The job line's client price per unit — what the usage report values the units at." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: "The job line's company cost per unit." })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;
}

export class RestoreStockDto {
  @ApiProperty()
  @IsString()
  containerId!: string;

  @ApiProperty({ type: [RestoreItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RestoreItemDto)
  items!: RestoreItemDto[];

  @ApiProperty()
  @IsString()
  dealId!: string;

  @ApiProperty()
  @IsString()
  performedBy!: string;

  @ApiProperty()
  @IsString()
  performedByName!: string;

  @ApiPropertyOptional({
    type: UsageJobDto,
    description:
      'The job as deal-service sees it — files the inventory-usage row under the job date and ' +
      'names the job, client and technicians. Optional: an older caller still moves stock.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UsageJobDto)
  job?: UsageJobDto;
}
