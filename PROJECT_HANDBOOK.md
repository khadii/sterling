# Sterling HR & Recruitment Platform — Project Handbook

This document is a complete, self-contained onboarding reference for the
codebase. Paste it into any AI assistant (DeepSeek, ChatGPT, Claude, etc.)
before asking it to add a feature, fix a bug, or write a new endpoint, so it
understands the architecture, conventions, and file locations without needing
prior conversation history.

---

## 1. What this is

An HR and recruitment platform ("HeyHR"/"Sterling") with an employer workspace,
employee self-service portal, jobs + hiring pipeline, leave, attendance,
onboarding, and a public careers board. The backend is a NestJS service backed
by Supabase (PostgreSQL).

**Stack**

- Node.js >= 20, NestJS 11, TypeScript 5.7 (strict)
- `@supabase/supabase-js` 2.56 (the only data-access layer)
- Swagger via `@nestjs/swagger` (served at `/docs`)
- `class-validator` + `class-transformer` for DTO validation
- Jest 29 + ts-jest for tests
- `sharp` (image processing), `nodemailer` (mail), `helmet`, `@nestjs/throttler`
- Deployed on Vercel (serverless). Database is Supabase.

---

## 2. The core architecture (read this first)

**Thin NestJS, fat PostgreSQL.** Almost all business logic, validation,
permissions, and transactions live in Postgres RPC functions. The NestJS layer
only:

1. Authenticates and authorizes the HTTP request.
2. Validates the request DTO (class-validator).
3. Calls one RPC function through the Supabase service-role client.
4. Converts the result and returns it.

This means: **when you add a feature, you almost always write a SQL function
first, then a thin controller/service/DTO that calls it.**

**Request flow**

```
HTTP request
  -> global ThrottlerGuard (rate limit)
  -> SupabaseAuthGuard (verify JWT) — only on authenticated controllers
  -> ValidationPipe (validate @Body/@Query DTO, whitelist + forbidNonWhitelisted)
  -> Controller method
  -> Service method -> supabase.adminClient.rpc('function_name', args)
  -> Postgres function (permission check, business logic, returns jsonb)
  -> camel() conversion -> HTTP JSON response
```

---

## 3. Directory layout

```
sterling/
  src/
    main.ts                      # bootstrap: global prefix, pipes, swagger
    app.module.ts                # root module, env validation (Joi), modules
    auth/                        # JWT guard, auth controller/service, roles
    supabase/                    # SupabaseService + error mapper + timeout helper
    common/                      # camel/snake, DTO helpers, enums, types, filters
    organization-context/        # resolveOrganization()
    recruitment/                 # jobs, candidates, pipeline, automations, public board
    employee/                    # employee self-service
    hr/                          # employer HR (metrics, employees, leave, attendance)
    leave/                       # employer leave management
    notifications/               # invitations, notification prefs, mail worker
    employer-workspace/          # workspace dashboard/context
    employer-onboarding/         # company onboarding wizard
    organization-workflow/       # roles, permissions, departments, teams, members
    reference/                   # geography/lookup references
    department-icons/            # department icon management
    mail/                        # nodemailer wrapper
    health/                      # liveness
  supabase/migrations/           # timestamped SQL migrations (source of truth)
  test/                          # e2e spec + *.integration.sql (manual DB tests)
  docs/                          # feature-focused markdown docs
  scripts/                       # superadmin bootstrap, notification worker
  deployment/                    # Vercel env example
  vercel.json                    # framework = nestjs
  nest-cli.json, package.json, tsconfig.json
```

Each feature module follows this file convention:

```
src/<module>/
  <module>.module.ts
  <module>.controller.ts
  <module>.service.ts
  <module>.dto.ts            # request DTOs (class-validator + Swagger)
  <module>-response.dto.ts   # response DTOs (Swagger only)
  <module>.spec.ts           # unit tests
```

---

## 4. Route map (global prefix is `api/v1`)

| Controller | `@Controller()` | Auth |
|---|---|---|
| AuthController | `auth` | mixed |
| RecruitmentController | `employer` | `SupabaseAuthGuard` |
| PublicJobsController | `jobs` | none (public) |
| EmployeeController | `employee` | `SupabaseAuthGuard` |
| HrController | `employer/hr` | `SupabaseAuthGuard` |
| LeaveController | `employer/leave` | `SupabaseAuthGuard` |
| WorkflowController | `organization` | `SupabaseAuthGuard` |
| EmployerWorkspaceController | `employer` | `SupabaseAuthGuard` |
| EmployerOnboardingController | `employer/onboarding` | `SupabaseAuthGuard` |
| NotificationController | `` (root) + `internal/notifications` | `SupabaseAuthGuard` |
| ReferenceController | `reference` | mixed |
| DepartmentIconsController | `reference/department-icons` + `admin/department-icons` | mixed |

So a recruitment endpoint is `/api/v1/employer/jobs`, a public job board route is
`/api/v1/jobs`, and an employee route is `/api/v1/employee/profile`.

---

## 5. Authentication & authorization

**There is exactly one auth flow.** Employees, employers, and admins all sign in
the same way (`/api/v1/auth/sign-in`); there is no separate employee
registration path. An employee is just a workspace member whose `user_id` also
appears in `hr_employees`.

`SupabaseAuthGuard` (`src/auth/supabase-auth.guard.ts`):

1. Reads `Authorization: Bearer <jwt>`.
2. `supabase.publicClient.auth.getUser(token)` to verify it.
3. Loads the user's `user_roles` and sets `req.user = { id, email, roles }`.

**Workspace resolution** — `resolveOrganization(supabase, userId, header)`
(`src/organization-context/resolve-organization.ts`): picks the org from
`organization_members`, using the optional `X-Organization-Id` header when the
user belongs to more than one workspace. Controllers expose it via a private
`org(req)` helper.

**Public endpoints** simply omit `@UseGuards(SupabaseAuthGuard)`. They are still
rate-limited by the global `ThrottlerGuard`. Examples: `PublicJobsController`.

**SQL-side permission** — every protected RPC starts with a permission check:
`recruitment_require(p_actor, p_org, 'jobs.view')`, `hr_require(...)`, or
`workflow_has_permission(...)`. The SQL rejects with `errcode '42501'` on
failure; the NestJS error mapper turns that into `403`.

---

## 6. Step-by-step: add a new endpoint

This is the one recipe that covers most work. Example: add `GET /jobs/:id` for
the employer.

### 6.1 Write the SQL function (always first)

Create `supabase/migrations/YYYYMMDDHHMMSS_<description>.sql`:

```sql
begin;

create or replace function public.recruitment_my_feature(
  p_actor uuid, p_org uuid, p_id uuid
) returns jsonb language plpgsql stable set search_path = public as $$
declare result jsonb;
begin
  perform recruitment_require(p_actor, p_org, 'jobs.view');
  select jsonb_build_object('id', id, 'title', title, 'departmentName',
    (select name from departments where id = department_id and organization_id = p_org))
  into result from jobs where id = p_id and organization_id = p_org;
  if result is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return result;
end $$;

revoke all on function public.recruitment_my_feature(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.recruitment_my_feature(uuid, uuid, uuid) to service_role;
notify pgrst, 'reload schema';
commit;
```

Rules:

- Name it `recruitment_*`, `hr_*`, `employee_*`, or `workflow_*` by domain.
- `stable` for reads, `security invoker` by default; `security definer` only when
  you must read `auth.users` (e.g. `accept_organization_invitation`).
- Return `jsonb`. Use `to_jsonb(row)` for full rows (snake_case — the NestJS
  `camel()` fixes it), or `jsonb_build_object('camelKey', ...)` for composed
  shapes.
- Always `revoke` from `anon, authenticated` and `grant execute to service_role`.

### 6.2 Add the service method

In `src/recruitment/recruitment.service.ts`:

```ts
myFeature(actor: string, org: string, id: string) {
  return this.rpc('recruitment_my_feature', { p_actor: actor, p_org: org, p_id: id });
}
```

`this.rpc()` already camel-cases the result and maps DB errors. For DTO payloads
that must go snake_case into the RPC, use `snake(dto)` (from
`src/common/serialize.ts`).

### 6.3 Add the controller route

In `src/recruitment/recruitment.controller.ts`:

```ts
@Get('jobs/:id')
@ApiOkResponse({ type: MyResponseDto })
@ApiOperation({ summary: '...' })
async myFeature(@Req() req: RequestWithUser, @Param('id', ParseUUIDPipe) id: string) {
  return this.recruitment.myFeature(req.user.id, await this.org(req), id);
}
```

### 6.4 Add DTOs

Request DTO in `<module>.dto.ts` (class-validator + Swagger). Response DTO in
`<module>-response.dto.ts` (`@ApiProperty` only, no runtime validation).

### 6.5 Add a test

Unit test in `<module>.spec.ts` (mock `SupabaseService.adminClient`). Optionally
add SQL assertions to `test/recruitment.integration.sql`.

### 6.6 Verify

```bash
npm run build    # compile
npx jest         # unit tests
```

Then apply the migration to Supabase and deploy (see section 16).

---

## 7. NestJS conventions

### Import cheat sheet (copy these exact paths)

```ts
// Auth guard (for protected controllers)
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';

// Data access (inject into service constructors)
import { SupabaseService } from '../supabase/supabase.service';

// Request type carrying the authenticated user
import { RequestWithUser } from '../common/types/request-with-user.type';

// snake_case <-> camelCase
import { camel, snake } from '../common/serialize';

// Resolve the workspace from memberships + X-Organization-Id
import { resolveOrganization } from '../organization-context/resolve-organization';

// Map a Supabase/Postgres error to an HTTP exception
import { mapDatabaseError } from '../supabase/database-error.mapper';

// Optional uploaded file type (for FileInterceptor)
import { UploadedFile } from '../common/types/uploaded-file.type';

// File upload
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile } from '@nestjs/common';
```

The relative `../` depth depends on the file's location under `src/`; a
controller in `src/recruitment/` imports siblings as `./`, auth as
`../auth/...`, and common as `../common/...`.

### Service skeleton

```ts
import { Injectable } from '@nestjs/common';
import { camel, snake } from '../common/serialize';
import { resolveOrganization } from '../organization-context/resolve-organization';
import { mapDatabaseError } from '../supabase/database-error.mapper';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class MyService {
  constructor(private readonly supabase: SupabaseService) {}

  organization(user: string, header?: string) {
    return resolveOrganization(this.supabase, user, header);
  }

  private async rpc<T = Record<string, unknown>>(name: string, args: object): Promise<T> {
    const { data, error } = await this.supabase.adminClient
      .rpc(name, args as never)
      .abortSignal(AbortSignal.timeout(15000));
    if (error) throw mapDatabaseError(error, 'process request');
    return camel(data) as T;
  }
}
```

- **Service method signature order:** `(actor, org, ...domainArgs)`. The actor
  and org are always the first two arguments because every RPC needs them.
- **DTO naming:** request DTOs end in `Dto`; response DTOs end in `Dto` too but
  live in `*-response.dto.ts` and are referenced by `@ApiOkResponse({ type })`.
- **Validation:** the global `ValidationPipe` uses `whitelist: true` and
  `forbidNonWhitelisted: true`, so DTOs must declare every accepted field.
- **Enums** are `export const X = [...] as const` in the `.dto.ts` file and are
  passed to `@IsIn(X)`.
- **UUID params** use `@Param('id', ParseUUIDPipe)`.
- **Pagination:** query DTOs use `page` (1-based) and `limit`; omit both to
  return "everything" (services accumulate pages in bounded batches).

### Serialization

`src/common/serialize.ts`:

- `camel(value)` — recursively maps `snake_case` -> `camelCase`.
- `snake(value)` — recursively maps `camelCase` -> `snake_case`.

The DB returns `snake_case` (from `to_jsonb(table_row)`); `camel()` normalizes it
for the API. When you pass a DTO into an RPC as `p_data`, wrap it in `snake(dto)`.

---

## 8. SupabaseService

`src/supabase/supabase.service.ts` exposes two clients:

- `publicClient` — uses the publishable (anon) key. Used for auth verification.
- `adminClient` — uses the service-role key. Used for all RPC calls, table reads,
  and Storage. Bypasses RLS; never expose it to clients.

All data access goes through `adminClient.rpc(name, args)` or
`adminClient.from('table').select(...)`. The service-role key means the NestJS
app is the only thing that can call the protected RPC functions.

---

## 9. Error handling contract

`src/supabase/database-error.mapper.ts` maps Postgres/Supabase errors to HTTP:

| Code | HTTP | Meaning |
|---|---|---|
| `22023` | 400 | invalid input (raise with `errcode '22023'`) |
| `23503` | 400 | FK violation |
| `23505` | 409 | unique violation |
| `PT409` / `40001` | 409 | optimistic-concurrency conflict |
| `P0002` | 404 | not found (`raise ... using errcode = 'P0002'`) |
| `42501` | 403 | permission denied |
| `57014`, `57P01`, `08*`, `53*`, `PGRST0*` | 503 | timeout / unavailable |
| other | 500 | unexpected |

In SQL, throw meaningful errors with explicit `errcode`s so they map cleanly:

```sql
raise exception 'Job not found' using errcode = 'P0002';
raise exception 'Permission required' using errcode = '42501';
```

Some services add domain-specific handling on top (e.g. `RecruitmentService`
maps `PT409` to a `JOB_REVISION_CONFLICT` body with `reloadUrl`).

---

## 10. Migrations

- Location: `supabase/migrations/`.
- Filename: `YYYYMMDDHHMMSS_description.sql` (chronological order matters).
- Every migration is wrapped in `begin; ... commit;` and ends with
  `notify pgrst, 'reload schema';`.
- **RLS pattern** for new tables:

```sql
alter table public.my_table enable row level security;
revoke all on public.my_table from anon, authenticated;
grant all on public.my_table to service_role;
```

- **Functions** are defined with `create function` (or `create or replace
  function` to modify). Grants on a function are preserved across
  `create or replace`, so you do not need to re-grant when you replace one.
- **Never** read server files or run OS commands via SQL.
- Storage buckets are **not** created by SQL migrations — they are created in
  the Supabase dashboard (Storage). Existing buckets: `onboarding-logos`,
  `resumes` (both private).

**Important:** because migrations are often applied through the Supabase SQL
editor (not the CLI), the CLI's migration history may be missing those
timestamps. If you later adopt `supabase db push`, mark already-applied
migrations with `supabase migration repair --status applied <timestamp>` first.

---

## 11. Key tables (subset)

**Identity & org**

- `profiles` — one per auth user (`id` = `auth.users.id`); created by a trigger
  `on_auth_user_created` -> `handle_new_user()`.
- `organizations`, `organization_settings`, `organization_members`,
  `organization_roles`, `organization_role_permissions`,
  `organization_invitations`, `organization_department_members`,
  `organization_teams`, `organization_team_members`.
- `departments` — `(id, organization_id, name, ...)`; unique name per org.

**Recruitment**

- `jobs` — one row per job (title, department_id, status
  `draft|open|on_hold|closed`, `public_slug`, `published_at`, `posted_on`,
  salary band, `revision`).
- `job_pipeline_stages` — ordered stages per job (`category`
  `screening|interview|assessment|offer|hired|other`).
- `job_stage_automations` — per-stage automations (`kind`
  `email|calendar|ai_evaluation|reviewer_assignment|custom`, `label`,
  `is_enabled`, `config`).
- `candidates` — applications (`full_name`, `email`, `source`, `resume_url`,
  `status` `new|in_review|assessment|interview|offer|hired|rejected`, `stage_id`).
- `candidate_stage_events`, `candidate_reviewers`, `candidate_ai_evaluations`,
  `candidate_automation_runs`.
- Child tables: `job_responsibilities`, `job_qualifications`, `job_skills`,
  `job_screening_questions`, `job_benefits`, `job_hiring_team`,
  `job_publishing_channels`, `job_interviews`, `job_revision_history`.

**HR / employee**

- `hr_employees` — employer-managed record (`user_id` NOT NULL -> must be an
  `organization_members` row; `department_id`, `role_id`, `starts_on`,
  `annual_salary`, `currency`).
- `hr_onboarding` — onboarding checklist per employee.
- `hr_leave`, `hr_leave_entitlements`, `hr_attendance`,
  `hr_attendance_sessions`, `hr_announcements`, `hr_courses`,
  `hr_course_enrollments`, `hr_reviews`, `hr_expenses`.

**Cross-cutting**

- `notification_outbox`, `notification_preferences`, `calendar_events`,
  `organization_activities`.

---

## 12. Storage & file uploads

Files are uploaded through NestJS `FileInterceptor` (memory storage) and stored
in a **private** Supabase bucket via `adminClient.storage`, then the bucket path
is persisted in the record. The URL handed to clients is a **signed, time-limited
URL**, never a public URL.

Example (resume): `RecruitmentService.uploadResume()` uploads to the `resumes`
bucket and stores the relative path in `candidates.resume_url`;
`candidateResumeUrl()` issues a 1-hour signed URL. External URLs (submitted
instead of a file) are returned unchanged.

The file pattern (`src/employer-onboarding`):

```ts
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5_242_880 } }))
@ApiConsumes('multipart/form-data')
```

Validate `mimetype` and `size` in the service before uploading.

---

## 13. Notifications

Queue a notification from SQL with:

```sql
perform queue_notification(
  p_org, p_user, 'hr.hired', 'Subject', 'Body',
  'dedupe:key', 'essential', jsonb_build_object('k','v'), email_or_null
);
```

`queue_notification(p_org, p_user, p_kind, p_subject, p_body, p_key,
p_category, p_payload, p_email)` — the last `p_email` is for external
recipients (e.g. candidates) when `p_user` is null. A worker drains
`notification_outbox` and sends via `MailService`.

---

## 14. Testing

**Unit tests** — `*.spec.ts` under `src/`. They mock `SupabaseService`; no live
DB or network is required.

```ts
const service = new RecruitmentService({
  adminClient: {
    rpc: jest.fn(() => ({
      abortSignal: jest.fn().mockResolvedValue({ data: {...}, error: null }),
    })),
  },
} as unknown as SupabaseService);
```

**Integration tests** — `test/*.integration.sql`. These are run manually against
the real Supabase DB (paste into the SQL editor or `psql`). They use
`begin; ... rollback;` so nothing persists, and assert with
`if <condition> then raise exception 'message'; end if;`.

Run the full unit suite:

```bash
npx jest
```

---

## 15. Environment variables

Declared and validated in `src/app.module.ts` (Joi) and documented in
`.env.example`. The important ones:

- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`
- `API_PREFIX` (default `api/v1`), `PORT`, `CORS_ORIGIN`
- `SWAGGER_PATH` (default `docs`), `ENABLE_SWAGGER`
- `SMTP_*`, `MAIL_FROM`, `MAIL_MAX_RETRIES`
- `NOTIFICATION_FRONTEND_URL`, `NOTIFICATION_WORKER_SECRET`, `CRON_SECRET`
- Recruitment integrations (optional, empty by default):
  `PUBLIC_JOB_BOARD_URL`, `INTERVIEW_SCHEDULING_PROVIDER`,
  `JOB_SYNDICATION_PROVIDER`, `AI_PROVIDER`/`AI_API_KEY`/`AI_MODEL`.

When adding a new env var, add it to: `.env.example`, the Joi schema in
`app.module.ts`, and `deployment/vercel-env.example.yml`.

---

## 16. Build, run, deploy

```bash
npm install
npm run start:dev      # local dev (needs a valid .env)
npm run build          # nest build -> dist/
npx jest               # unit tests
```

**Deploy** is Vercel via Git: push to `origin/main` and Vercel rebuilds from
`dist/`. `vercel.json` sets `framework: nestjs`. Environment variables live in
Vercel Project Settings, not the repo.

**Database deploy** is separate: apply `supabase/migrations/*.sql` to the Supabase
project (dashboard SQL editor or `supabase db push`). A code deploy does NOT
apply SQL.

---

## 17. Naming conventions

- Files: kebab-case (`recruitment.service.ts`).
- Classes: PascalCase (`RecruitmentService`).
- Methods/vars: camelCase.
- SQL objects: snake_case (`job_pipeline_stages`, `hr_employees`).
- SQL functions: `domain_verb` (`recruitment_job_list`, `hr_member_directory`).
- API JSON: camelCase (DB `department_id` -> API `departmentId`).
- Migration filenames: `YYYYMMDDHHMMSS_description.sql`.

---

## 18. Gotchas & common mistakes

1. **Don't put business logic in NestJS.** Put it in the SQL function. The
   service is a passthrough.
2. **Always grant `service_role` and revoke `anon, authenticated`** on new
   functions and tables, or the browser role can reach them.
3. **`hr_employees.user_id` is NOT NULL** and must reference an
   `organization_members` row — you cannot create an employee record for someone
   without an account.
4. **Never return public URLs for private files** (resumes, logos). Store the
   bucket path and issue signed URLs on demand.
5. **`snake(dto)` before passing DTOs into RPC `p_data`**, and `camel()` the
   result (the service `rpc()` helper already camel-cases).
6. **Zero counts must be `0`, not null** — use `coalesce(count(...), 0)` and
   `greatest(..., 0)`; undefined percentages are `null`.
7. **Revisions are last-write-wins with optional `expectedRevision`.** A stale
   value raises `PT409`; the response includes `currentRevision` and `reloadUrl`.
8. **`create or replace function` preserves grants**, but a brand-new function
   needs its own `revoke`/`grant` block.
9. **Do not invent a second auth path** — employees and employers share the
   single Supabase auth + membership flow.
10. **AI/provider integrations are intentionally deferred** — `ai_evaluation`
    and `custom` automation kinds are `executable: false`. Do not claim they run.
