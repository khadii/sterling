import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployerWorkspaceController } from './employer-workspace.controller';
import { EmployerWorkspaceService } from './employer-workspace.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployerWorkspaceController],
  providers: [EmployerWorkspaceService],
})
export class EmployerWorkspaceModule {}
