import { Module } from '@nestjs/common';
import { CallDevicesController } from './call-devices.controller';
import { CallDevicesService } from './call-devices.service';
import { CallDevicesRepository } from './call-devices.repository';

/** The Devices catalog; groups and flows import it to resolve what they ring. DynamoDbModule is @Global. */
@Module({
  controllers: [CallDevicesController],
  providers: [CallDevicesService, CallDevicesRepository],
  exports: [CallDevicesService],
})
export class CallDevicesModule {}
