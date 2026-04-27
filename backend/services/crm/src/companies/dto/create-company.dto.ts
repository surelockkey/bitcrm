import {
  IsString, IsOptional, IsEnum, IsArray,
  ArrayMaxSize, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType } from '@bitcrm/types';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional({ example: ['(404) 555-9999'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  phones?: string[];

  @ApiPropertyOptional({ example: ['info@acme.com'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  emails?: string[];

  @ApiPropertyOptional({ example: '456 Business Ave' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'https://acme.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiProperty({ enum: ClientType, example: ClientType.COMMERCIAL })
  @IsEnum(ClientType)
  clientType!: ClientType;

  @ApiPropertyOptional({ example: 'Key account' })
  @IsOptional()
  @IsString()
  notes?: string;
}
