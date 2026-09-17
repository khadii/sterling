import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { EmployerWorkspaceModule } from '../employer-workspace/employer-workspace.module';
import { TaskAttachmentsService } from './task-attachments.service';

@Module({
  imports: [AuthModule, EmployerWorkspaceModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, TaskAttachmentsService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
