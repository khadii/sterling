import { ZoomService } from './zoom.service';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
@Module({
  imports: [AuthModule],
  controllers: [HrController],
  providers: [HrService, ZoomService],
  exports: [HrService],
})
export class HrModule {}
