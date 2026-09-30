import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TransferType } from '@bitcrm/types';

export class ListTransfersQueryDto {
  @ApiPropertyOptional({
    enum: TransferType,
    description: 'Only transfers of this type — filtered on the server, the count too.',
  })
  @IsOptional()
  @IsEnum(TransferType)
  type?: TransferType;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
