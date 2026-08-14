import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangeDealClientDto {
  @ApiProperty({
    example: 'e1b9c2a4-5d3f-4a71-9c8e-2f6d1b0a7e34',
    description: 'The contact this job should belong to from now on.',
  })
  @IsString()
  @IsNotEmpty()
  contactId!: string;
}
