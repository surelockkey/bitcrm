import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** The technicians of a commissions-report period, by id. */
export class LookupCommissionHistoriesDto {
  @ApiProperty({ type: [String], example: ['c32ebecf-…', '8eec7d68-…'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  userIds!: string[];
}
