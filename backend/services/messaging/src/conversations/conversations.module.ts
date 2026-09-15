import { Module } from '@nestjs/common';
import { ConversationsRepository } from './conversations.repository';

@Module({
  providers: [ConversationsRepository],
  exports: [ConversationsRepository],
})
export class ConversationsModule {}
