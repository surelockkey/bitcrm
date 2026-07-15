import { IsNumber, IsOptional, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetLocationDto {
  @ApiProperty({ example: 33.749 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -84.388 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiPropertyOptional({ example: 15, description: 'GPS accuracy in metres.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}
