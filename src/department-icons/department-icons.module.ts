import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  DepartmentIconAdminController,
  DepartmentIconReferenceController,
} from './department-icons.controller';
import { DepartmentIconsService } from './department-icons.service';
import { PlatformIconGuard } from './platform-icon.guard';

@Module({
  imports: [AuthModule],
  controllers: [
    DepartmentIconAdminController,
    DepartmentIconReferenceController,
  ],
  providers: [DepartmentIconsService, PlatformIconGuard],
})
export class DepartmentIconsModule {}
