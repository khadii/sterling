import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { camel, snake } from '../common/serialize';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';
import type {
  EmployeeClockDto,
  EmployeeCourseProgressDto,
  EmployeeLeaveRequestDto,
  EmployeeRangeQueryDto,
  EmployeeTaskStatusDto,
} from './employee.dto';
import type {
  EmployeeAnnouncementsDto,
  EmployeeAttendanceDto,
  EmployeeCalendarDto,
  EmployeeDashboardDto,
  EmployeeDocumentsDto,
  EmployeeLearningDto,
  EmployeeLeaveDetailDto,
  EmployeeLeaveDto,
  EmployeePayslipsDto,
  EmployeeProfileDto,
  EmployeeTasksDto,
  EmployeeTeamDto,
} from './employee-response.dto';

/**
 * Self-service reads and writes for the signed-in employee. The database
 * resolves the caller to its own hr_employees row, so these endpoints never
 * accept an employee id and never expose another account's records.
 */
@Injectable()
export class EmployeeService {
  constructor(private readonly supabase: SupabaseService) {}

  organization(user: string, header?: string) {
    return resolveOrganization(this.supabase, user, header);
  }

  private async rpc<T>(name: string, args: object): Promise<T> {
    const { data, error } = await this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(15000));
    if (error?.code === '22023') throw new BadRequestException(error.message);
    if (error?.code === 'P0002')
      throw new NotFoundException(error.message ?? 'Employee record not found');
    if (error?.code === '42501') throw new ForbiddenException(error.message);
    if (error) throw mapDatabaseError(error, 'process employee request');
    return camel(data) as T;
  }

  profile(actor: string, org: string) {
    return this.rpc<EmployeeProfileDto>('employee_profile', {
      p_actor: actor,
      p_org: org,
    });
  }

  dashboard(actor: string, org: string) {
    return this.rpc<EmployeeDashboardDto>('employee_dashboard', {
      p_actor: actor,
      p_org: org,
    });
  }

  leave(actor: string, org: string) {
    return this.rpc<EmployeeLeaveDto>('employee_leave', {
      p_actor: actor,
      p_org: org,
    });
  }

  leaveDetail(actor: string, org: string, id: string) {
    return this.rpc<EmployeeLeaveDetailDto>('employee_leave_detail', {
      p_actor: actor,
      p_org: org,
      p_id: id,
    });
  }

  requestLeave(actor: string, org: string, dto: EmployeeLeaveRequestDto) {
    return this.rpc<EmployeeLeaveDetailDto>('employee_leave_request', {
      p_actor: actor,
      p_org: org,
      p_data: snake(dto),
    });
  }

  cancelLeave(actor: string, org: string, id: string) {
    return this.rpc<EmployeeLeaveDetailDto>('employee_leave_cancel', {
      p_actor: actor,
      p_org: org,
      p_id: id,
    });
  }

  attendance(actor: string, org: string, query: EmployeeRangeQueryDto) {
    return this.rpc<EmployeeAttendanceDto>('employee_attendance', {
      p_actor: actor,
      p_org: org,
      p_from: query.from ?? null,
      p_to: query.to ?? null,
    });
  }

  clock(actor: string, org: string, dto: EmployeeClockDto) {
    return this.rpc<EmployeeAttendanceDto>('employee_clock', {
      p_actor: actor,
      p_org: org,
      p_action: dto.action,
      p_work_mode: dto.workMode ?? null,
    });
  }

  tasks(actor: string, org: string) {
    return this.rpc<EmployeeTasksDto>('employee_tasks', {
      p_actor: actor,
      p_org: org,
    });
  }

  updateTask(
    actor: string,
    org: string,
    id: string,
    dto: EmployeeTaskStatusDto,
  ) {
    return this.rpc<EmployeeTasksDto>('employee_task_status', {
      p_actor: actor,
      p_org: org,
      p_id: id,
      p_status: dto.status,
    });
  }

  team(actor: string, org: string) {
    return this.rpc<EmployeeTeamDto>('employee_team', {
      p_actor: actor,
      p_org: org,
    });
  }

  documents(actor: string, org: string) {
    return this.rpc<EmployeeDocumentsDto>('employee_documents', {
      p_actor: actor,
      p_org: org,
    });
  }

  payslips(actor: string, org: string) {
    return this.rpc<EmployeePayslipsDto>('employee_payslips', {
      p_actor: actor,
      p_org: org,
    });
  }

  announcements(actor: string, org: string) {
    return this.rpc<EmployeeAnnouncementsDto>('employee_announcements', {
      p_actor: actor,
      p_org: org,
    });
  }

  learning(actor: string, org: string) {
    return this.rpc<EmployeeLearningDto>('employee_learning', {
      p_actor: actor,
      p_org: org,
    });
  }

  updateCourseProgress(
    actor: string,
    org: string,
    courseId: string,
    dto: EmployeeCourseProgressDto,
  ) {
    return this.rpc<EmployeeLearningDto>('employee_course_progress', {
      p_actor: actor,
      p_org: org,
      p_course: courseId,
      p_progress: dto.progress,
    });
  }

  calendar(actor: string, org: string, query: EmployeeRangeQueryDto) {
    return this.rpc<EmployeeCalendarDto>('employee_calendar', {
      p_actor: actor,
      p_org: org,
      p_from: query.from ?? null,
      p_to: query.to ?? null,
    });
  }
}
