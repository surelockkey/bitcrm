import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CopyToJobDto {
  @ApiProperty({ example: 'deal-uuid', description: "One of the client's jobs — usually one just created for this estimate." })
  @IsString()
  @MaxLength(120)
  dealId!: string;
}
