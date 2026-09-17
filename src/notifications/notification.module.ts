import { Module } from '@nestjs/common';
import { WorkflowModule } from '../organization-workflow/workflow.module';
import { MailModule } from '../mail/mail.module';
import {
  NotificationController,
  NotificationWorkerController,
} from './notification.controller';
import { NotificationService } from './notification.service';
@Module({
  imports: [WorkflowModule, MailModule],
  controllers: [NotificationController, NotificationWorkerController],
  providers: [NotificationService],
})
export class NotificationModule {}
