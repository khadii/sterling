export enum UserRole {
  EMPLOYER = 'employer',
  JOB_SEEKER = 'job_seeker',
}

export const SELF_ASSIGNABLE_ROLES: readonly UserRole[] = [
  UserRole.EMPLOYER,
  UserRole.JOB_SEEKER,
];
