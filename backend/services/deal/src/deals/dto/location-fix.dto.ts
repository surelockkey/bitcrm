import { IsLatitude, IsLongitude, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * The phone's GPS fix at the moment of a status change — the bounds
 * `MarkArrivedDto` puts on an arrival's, with both coordinates required
 * (a half fix places nothing) and typed as numbers.
 */
export class LocationFixDto {
  @ApiProperty({ description: 'Latitude of the phone, −90..90.', example: 41.7637 })
  @IsNumber()
  @IsLatitude()
  lat!: number;

  @ApiProperty({ description: 'Longitude of the phone, −180..180.', example: -72.6851 })
  @IsNumber()
  @IsLongitude()
  lng!: number;

  @ApiPropertyOptional({ description: 'Reported accuracy of the fix, in metres.', minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;
}
