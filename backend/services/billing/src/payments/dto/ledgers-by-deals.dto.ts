import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** The jobs of one commissions-report page, by id. */
export class LedgersByDealsDto {
  @ApiProperty({ type: [String], example: ['417f7b73-…', '8eec7d68-…'] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(100)
  dealIds!: string[];
}
