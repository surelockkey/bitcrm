import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * `POST /deals/:id/tech/arrived` — the technician is at the door (Workiz
 * "Arrived at location", 30 427 of them in the export).
 *
 * Every field is optional: a phone that refuses the location permission still
 * has to be able to say it arrived.
 */
export class MarkArrivedDto {
  @ApiPropertyOptional({ description: 'Latitude of the phone at the moment of arrival.', example: 41.7637 })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: 'Longitude of the phone at the moment of arrival.', example: -72.6851 })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({ description: 'Reported accuracy of the fix, in metres.', minimum: 0, maximum: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy?: number;

  @ApiPropertyOptional({
    description:
      'Catalog sub-status to apply on arrival; must belong to In Progress. ' +
      'Omit to let the server pick the catalog’s own arrival sub-status, if it has one.',
  })
  @IsOptional()
  @IsString()
  subStatusId?: string;
}
