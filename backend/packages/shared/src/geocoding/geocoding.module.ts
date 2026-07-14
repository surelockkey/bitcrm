import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { GeocodingService } from './geocoding.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [GeocodingService],
  exports: [GeocodingService],
})
export class GeocodingModule {}
