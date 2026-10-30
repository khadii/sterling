# Employee self-service: backend flow and testing

This documents the employee portal surface: the auth model, which tables and
functions back it, how each designed screen maps onto API calls, and how to
test it.

## Auth: employees use the existing flow

There is no separate employee registration or login. An employee is the same
Supabase auth user the rest of the product already issues:

`auth.users` -> `public.profiles` -> `public.organization_members` -> `public.hr_employees.user_id`

`hr_employees.user_id` is the same account id, and the table's foreign key to
`organization_members(organization_id, user_id)` means an employee must already
be a workspace member. Employers add an employee record for an account that was
invited through the normal invitation path, exactly as migration
`0013_hr_dashboard.sql` states: "Employer-managed HR records, not a second
employee registration flow."

Practically, that means:

| Concern | Behaviour |
| --- | --- |
| Sign-up / sign-in / Google / OTP / refresh | Unchanged, `src/auth` |
| Workspace selection | Unchanged, `X-Organization-Id` header |
| Account role (`employer`, `job_seeker`) | Unchanged; an employee account is normally an `employer` role holder who also has an `hr_employees` row |
| What the employee sees | `src/employee`, scoped to their own `hr_employees` row |
| What HR sees about them | `src/hr` under `/employer/hr/*`, unchanged |

A signed-in account without an `hr_employees` row gets `404` from every
`/employee/*` route rather than an empty page, so the frontend can branch on
that and show the employer workspace instead.

## What is implemented

`src/employee` owns the employee surface. It reads and writes only through
service-role SQL functions in
`supabase/migrations/20261024120000_employee_self_service.sql`, so the caller is
resolved to its own record inside the database. No `/employee/*` route accepts
an employee id.

New tables:

| Table | Purpose |
| --- | --- |
| `hr_attendance_sessions` | One row per employee per day: check in, check out, break window and accumulated break minutes, work mode |
| `hr_announcements` | Company notices with category, publish date and optional expiry |
| `hr_courses` | Course catalogue: title, description, duration, level, published flag |
| `hr_course_enrollments` | Per-employee progress: status, percent, started and completed timestamps |

Leave types were extended from `annual`, `sick`, `study` to also accept
`personal`, `maternity`, `paternity`, `compassionate` and `unpaid`, matching the
design. Entitlement remains mandatory for `annual`, `sick` and `study`; the
extended types are only capped when an entitlement row exists for that employee,
year and type.

## Screen to endpoint mapping

### My Dashboard

`GET /api/v1/employee/dashboard`

| Screen element | Response field |
| --- | --- |
| Greeting name, employee id, department, role, manager | `profile` |
| Company announcements | `announcements[]` (latest three, unexpired) |
| Currently clocked in, today's hours, work mode | `clock` (`hours`, `targetHours`, `workMode`, `checkedIn`) |
| My Agenda | `agenda[]` for today |
| Leave Balance | `leave.balances[]`, `leave.pending`, `leave.nextLeave` |
| My Tasks | `tasks` (counts plus `tasks.next[]`) |
| Learning progress | `learning` |
| Upcoming review | `review` |
| My Team | `team[]` |

Totals that have no denominator are returned as `null`, never as a fabricated
zero, matching the rest of the statistics contract.

### My Profile

`GET /api/v1/employee/profile` returns identity, employment dates, probation
end, department, role, manager, salary and currency for the caller only.

### Leave

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/leave` | Entitlements, upcoming leave, history, summary |
| POST | `/api/v1/employee/leave` | Submit a request; starts `pending` and notifies the approval chain |
| GET | `/api/v1/employee/leave/{id}` | One request with its approval timeline |
| POST | `/api/v1/employee/leave/{id}/cancel` | Withdraw a pending request |

`GET /leave` returns `balances[]` (entitled, used, remaining, usedPercent),
`upcoming[]`, `history[]` and `summary`. `targetHours` style percentages are
computed with `hr_percent`, so a zero denominator yields `null`.

Requests are validated before insert: leave type must be one of the eight,
dates must be `YYYY-MM-DD`, start and end must fall in the same year, the range
must contain at least one working day, the range must sit inside the employment
window, and it must not overlap an existing pending or approved request. The
existing `hr_leave` triggers then create the approval steps and notify the first
approver.

`GET /leave/{id}` includes `approvalSteps[]` with position, approver name and
decision, plus `decidedByName` and `decisionReason`, which is what the designed
"Leave Application" and rejection screens render.

### Time & Attendance

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/attendance?from=&to=` | Clock sessions, approved attendance records and month counts |
| POST | `/api/v1/employee/attendance/clock` | `in`, `out`, `break-start`, `break-end` |

Clocking out writes or updates the `hr_attendance` row for the day with status
`pending`, so the employer approval flow is unchanged. Checking in after 09:15
local time records `late`.

### My Tasks, My Team, Documents, Payslips, Learning, Calendar

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/v1/employee/tasks` | Tasks assigned to the caller with counts |
| PATCH | `/api/v1/employee/tasks/{id}` | Move an assigned task between `todo`, `in_progress`, `done` |
| GET | `/api/v1/employee/team` | Department and team colleagues with derived presence |
| GET | `/api/v1/employee/documents` | Documents held for the caller, with expiry flags |
| GET | `/api/v1/employee/payslips` | Finalized payslips only |
| GET | `/api/v1/employee/announcements` | Published announcements |
| GET | `/api/v1/employee/learning` | Course catalogue with the caller's progress |
| PATCH | `/api/v1/employee/learning/{courseId}` | Set progress 0-100; status follows |
| GET | `/api/v1/employee/calendar?from=&to=` | Events the caller organizes or attends |

Team presence is derived, not stored: `out_of_office` when approved leave covers
today, `in_meeting` when a calendar event is in progress, then
`working_office` / `working_remote` / `working_hybrid` while clocked in, else
`offline`.

## Local testing

1. Apply the migration to a scratch database, then confirm the surface:

   ```sql
   select count(*) from public.hr_attendance_sessions;
   select proname from pg_proc
   where proname like 'employee\_%'
   order by proname;
   ```

2. Give a test account an `hr_employees` row in a workspace it already belongs
   to, then call the routes with that account's bearer token:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" \
     -H "X-Organization-Id: $ORG" \
     "$API/api/v1/employee/dashboard" | jq
   ```

3. Check that isolation actually holds: the same token against another
   workspace must return `403` (not a member) or `404` (no employee record), and
   `POST /employee/leave` must reject a range that overlaps an existing request
   with `400`.

4. `npx jest src/employee` covers payload translation, error mapping, the "no
   caller-supplied employee id" invariant, request validation and the published
   OpenAPI routes.

## Not in this pass

These are designed on the employer side and are still open:

- configurable leave policies (eligibility, accrual, carryover, blackout,
  assignment) and leave reports
- multi-level approval chains with escalation (today `hr_approval_chains` holds
  one flat approver list per kind)
- employer screens for authoring announcements and courses; the employee
  endpoints read those tables, so until an authoring surface exists they are
  empty
- Messages, and the Payslip detail view beyond the list
