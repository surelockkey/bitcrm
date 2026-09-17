import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { TemplatesModule } from '../templates/templates.module';
import { BusinessProfileController, BusinessProfilesController } from './business-profile.controller';
import { BusinessProfileRepository } from './business-profile.repository';
import { BusinessProfileService } from './business-profile.service';

@Module({
  imports: [AssetsModule, TemplatesModule],
  controllers: [BusinessProfilesController, BusinessProfileController],
  providers: [BusinessProfileRepository, BusinessProfileService],
  exports: [BusinessProfileService],
})
export class BusinessProfileModule {}
