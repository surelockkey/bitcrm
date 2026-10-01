import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class CreateProposalDto {
  @ApiProperty({ example: 'deal-uuid', description: 'The job whose open estimates go out together.' })
  @IsString()
  @MaxLength(120)
  dealId!: string;
}
