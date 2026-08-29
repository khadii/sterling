import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployerOnboardingController } from './employer-onboarding.controller';
import { EmployerOnboardingService } from './employer-onboarding.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployerOnboardingController],
  providers: [EmployerOnboardingService],
})
export class EmployerOnboardingModule {}
