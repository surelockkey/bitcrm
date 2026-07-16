import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReorderDto {
  @ApiProperty({ description: 'The technician whose day is being reordered.' })
  @IsString()
  techId!: string;

  @ApiProperty({
    description: 'Deal ids in the new visit order; sequence 1..N is written in this order.',
    type: [String],
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderedDealIds!: string[];
}
