import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GeographyReferenceService } from './geography-reference.service';
import { ReferenceController } from './reference.controller';
import { ReferenceService } from './reference.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferenceController],
  providers: [ReferenceService, GeographyReferenceService],
})
export class ReferenceModule {}
