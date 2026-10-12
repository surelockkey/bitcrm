import { PartialType } from '@nestjs/swagger';
import { CreateItemGroupDto } from './create-item-group.dto';

/**
 * Workiz's "Edit item group", and the trash / Enable switch (`active`). Only
 * what is sent changes; `members`, when sent, is the whole new list.
 */
export class UpdateItemGroupDto extends PartialType(CreateItemGroupDto) {}
