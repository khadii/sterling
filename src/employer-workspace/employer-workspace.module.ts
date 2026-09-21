import { HrModule } from '../hr/hr.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployerWorkspaceController } from './employer-workspace.controller';
import { EmployerWorkspaceService } from './employer-workspace.service';

@Module({
  imports: [AuthModule, HrModule],
  controllers: [EmployerWorkspaceController],
  providers: [EmployerWorkspaceService],
  exports: [EmployerWorkspaceService],
})
export class EmployerWorkspaceModule {}
