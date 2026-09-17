import { Module } from '@nestjs/common';
import { BusinessProfilesClient } from './business-profiles.client';

/** One shared (cached) client of billing's company list. */
@Module({
  providers: [BusinessProfilesClient],
  exports: [BusinessProfilesClient],
})
export class BusinessProfilesClientModule {}
