import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignRoleDto {
  @ApiProperty({
    example: 'role-dispatcher',
    description: 'ID of the role to assign to the user',
  })
  @IsString()
  roleId!: string;
}
