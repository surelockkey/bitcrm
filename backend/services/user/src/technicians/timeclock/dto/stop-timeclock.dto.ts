import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * No timestamp field on purpose: the stop instant is the server's, so a phone
 * with a wrong (or deliberately rewound) clock cannot lengthen a shift.
 */
export class StopTimeClockDto {
  @ApiPropertyOptional({ example: 33.749, description: 'Omitted if location permission was refused.' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ example: -84.388 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ example: 15, description: 'GPS accuracy in metres.' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}
