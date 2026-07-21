import { IsArray, IsString, ArrayUnique, ArrayNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignServiceAreasDto {
  @ApiProperty({
    type: [String],
    example: ['Atlanta Metro', 'North Georgia'],
    description:
      'Catalog service-area names to grant the technician directly (already approved).',
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  serviceAreas!: string[];
}
