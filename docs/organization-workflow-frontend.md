# Department → Role → Team → Project → Task

Verified against Hey-HR in Figma on 14 September 2026 using the connected Figma tools. No designs were edited. This document describes the implementation in this repository; it does not claim a production deployment.

## Design references and decisions

| Screen | Verified fields/actions | Figma |
|---|---|---|
| Create Role: Basic Info | Department, name, level, employment type, location, on-site/remote/hybrid, description, Save as Draft | [566:3029](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=566-3029) |
| Requirements | Responsibilities, skills, qualifications, experience range, certifications, languages, other requirements | [566:3799](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=566-3799) |
| Organization & Access | Reporting manager, approval checkboxes and system permission chips | [567:4856](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=567-4856) |
| Benefits | Salary range, leave types, review frequency, probation, growth, succession, reporting line, custom benefits | [568:6226](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=568-6226) |
| Review | Review sections and Create Role | [568:7128](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=568-7128) (layer text inspected) |
| Create Sub-team | Name, optional description, locked department, initial members | [566:1323](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=566-1323) |
| Create Project | Name, department, sub-team, low/medium/high priority, start/end, description, resource manager | [610:1335](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=610-1335) |
| Create Task | Name, description, assignee, low/normal/high/urgent priority, dates, status | [765:4955](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=765-4955) |
| Task detail | Edit/complete/delete, notes, attachments, activity history | [749:4257](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=749-4257) |

The department creation contract reuses the existing name/description/icon implementation and the previously inspected onboarding department form. The post-onboarding department creation modal was not separately identified in the current file inventory.

The access step means a department role combines a job definition with explicitly chosen permissions. Existing `organization_roles` and grant/assignment tables are retained; the migration adds department, draft status and definition fields rather than creating a competing role system. Standalone custom access roles may omit departmentId. A sub-team belongs directly to a department, not to a role. Its members may have different roles. A project selects one existing team in the department; tasks belong to that project. Creating any of these does not automatically assign roles to members.

## Authentication and workspace selection

Prefix all routes below with `/api/v1`. Send `Authorization: Bearer <session.access_token>`.

For all new `/organization/*` routes, omit organizationId when the account has one membership. The backend resolves it using the verified user ID. For multiple memberships select one with `X-Organization-Id: <organization UUID>` (or the optional organizationId query parameter). It is validated against membership; it is never trusted as authorization. No frontend-generated IDs are required. Resource IDs in path/body are IDs returned by earlier API responses.

The older `/employer/*` endpoints remain compatible and still take organizationId. Use the new `/organization/departments` routes for the resolved-workspace flow.

## Endpoint sequence

| Action | Endpoint |
|---|---|
| Departments | `GET/POST /organization/departments`, `GET /organization/departments/:departmentId` |
| Permission choices | `GET /organization/permissions` |
| Member picker | `GET /organization/members?search=email&page=1&limit=20` |
| Role wizard | `POST /organization/roles`, `GET/PATCH /organization/roles/:roleId` |
| Department role directory | `GET /organization/roles?departmentId=<id>` |
| Replace role grants | `PUT /organization/roles/:roleId/permissions` |
| Assign active roles | `POST /organization/members/:userId/roles` |
| Remove assignment | `DELETE /organization/members/:userId/roles/:roleId` |
| Sub-teams | `GET/POST /organization/teams`, `GET/PATCH /organization/teams/:teamId` |
| Team directory | `GET/PUT /organization/teams/:teamId/members` |
| Projects | `GET/POST /organization/projects`, `GET/PATCH /organization/projects/:projectId` |
| Create project task | `POST /organization/projects/:projectId/tasks` |
| Tasks | `GET /organization/tasks?projectId=<id>`, `GET/PATCH/DELETE /organization/tasks/:taskId` |
| Notes | `GET/POST /organization/tasks/:taskId/notes` |
| History | `GET /organization/tasks/:taskId/history` |
| Upload/list attachments | `POST/GET /organization/tasks/:taskId/attachments` |
| Download URL | `GET /organization/tasks/:taskId/attachments/:attachmentId/download` |
| Remove attachment | `DELETE /organization/tasks/:taskId/attachments/:attachmentId` |

Roles, teams, projects, tasks, notes, history and member directories use `{ items, total, page, limit }`, with a default limit of 20 and maximum 100. Teams can be filtered by departmentId; projects by departmentId/teamId; tasks by projectId. Resource name search uses `search`. Department listing preserves the existing summary/items format. Attachment listing returns `{items}` (maximum 100).

## Example Value: create department

`POST /organization/departments`

```json
{ "name": "Engineering", "description": "Product development and infrastructure" }
```

Optionally supply an existing iconId from the reference icon catalogue. The API uses the default icon when omitted. Use the returned id as departmentId below.

## Example Value: role wizard

First save, `POST /organization/roles`:

```json
{
  "name": "Senior Backend Engineer",
  "departmentId": "35826d6c-937d-4726-9a25-5bdbb492744a",
  "status": "draft",
  "level": "L5 - Senior",
  "employmentType": "full_time",
  "location": "Lagos, Nigeria",
  "workArrangement": "hybrid",
  "description": "Design reliable backend services."
}
```

The response includes `id`, a server-generated `key`, `organizationId`, `status`, `isSystem: false`, timestamps and `permissionIds`. Store the returned id and use `PATCH /organization/roles/:roleId` for subsequent saves. `GET` on the same URL resumes the wizard.

```json
{
  "requirements": {
    "responsibilities": ["Design APIs", "Review technical designs"],
    "skills": ["TypeScript", "PostgreSQL"],
    "minimumDegree": "Bachelors Degree",
    "fieldOfStudy": "Computer Science",
    "minYears": 3,
    "maxYears": 7,
    "certifications": [],
    "languages": ["English (Fluent)"],
    "otherRequirements": "Occasional travel"
  },
  "reportsToUserId": "b2d84ce6-35b5-4c02-a39b-4732acfe91cb",
  "permissionIds": ["workspace.view", "teams.view", "teams.manage"],
  "benefits": {
    "currency": "USD",
    "minimumSalary": 80000,
    "maximumSalary": 120000,
    "leaveTypes": ["annual", "sick"],
    "salaryReviewFrequency": "annual",
    "probationMonths": 3,
    "growthReviewFrequency": "monthly",
    "successionPath": "Senior Engineer to Lead Engineer",
    "reportingLine": "Engineering Manager",
    "benefits": ["Health benefits", "Pension", "Learning budget"]
  }
}
```

Omitted top-level fields are preserved. Supplying requirements or benefits replaces that entire section; send the complete edited section. Send `reportsToUserId: null` to clear the manager. All other role fields reject explicit null. Maximum experience/salary cannot be below minimum; salary requires a three-letter currency. Amounts are annual base salary in currency units, not minor units.

After review, send `PATCH { "status": "active" }`. Department role activation requires name, level, employmentType, workArrangement and description. Optional benefits and qualifications stay optional. Drafts cannot be assigned and assigned active roles cannot be changed back to draft.

### Schema: access step

| Figma label | permissionId |
|---|---|
| Approve Leave | `leave.approve` |
| Approve Attendance | `attendance.approve` |
| Performance Reviews | `performance.approve` |
| Expense Claims | `expenses.approve` |
| View / Manage Team | `teams.view` / `teams.manage` |
| View / Manage Employees | `employees.view` / `employees.manage` |
| Create Jobs | `jobs.create` |
| Manage Candidates | `candidates.manage` |

Use `GET /organization/permissions` for the canonical catalogue. The four approval permissions and employee permissions are stored for the corresponding future modules; this change does not implement leave, expense, attendance, employee-record or recruitment workflows. No permission chip should be described as implementing those workflows by itself.

Permission IDs are explicit. The backend rejects unknown IDs, edits to system roles, custom grants of ownership/billing permissions, and grants beyond a non-owner editor's permissions. Owners may configure ordinary custom-role permissions. Protecting system owners also prevents this API from deleting the final owner. Ownership transfer remains a separate operation.

For grants-only edits:

```json
{ "permissionIds": ["workspace.view", "teams.view", "projects.view", "tasks.view"] }
```

`PUT /roles/:roleId/permissions` replaces the set atomically. Empty clears it. Changes affect existing assignees on their next permission check; a token refresh is not needed because grants are read from the database.

Assign with `POST /organization/members/:userId/roles`:

```json
{ "roleIds": ["da0ea39c-2cbb-4216-a460-e65b8b349c53"] }
```

This adds roles idempotently and preserves other assignments. It returns `{userId, roleIds}`. Role assignment requires `roles.assign`; role changes require `roles.manage`; role listings require `roles.view`, which also protects compensation details.

## Example Value: team, project and task

`POST /organization/teams`:

```json
{
  "departmentId": "35826d6c-937d-4726-9a25-5bdbb492744a",
  "name": "Backend Core",
  "description": "Core API development",
  "memberIds": ["b2d84ce6-35b5-4c02-a39b-4732acfe91cb"]
}
```

Initial members and the team are saved together. `PUT /teams/:teamId/members` takes `{memberIds:[...]}` and replaces the list. Every user must already be an organization member. New team creation does not require first creating a job role.

`POST /organization/projects`:

```json
{
  "departmentId": "35826d6c-937d-4726-9a25-5bdbb492744a",
  "teamId": "af29d3e8-8881-4387-a59f-bf3fbb8fba25",
  "name": "Core API v2 Refactor",
  "priority": "medium",
  "startDate": "2026-10-01",
  "endDate": "2026-12-01",
  "description": "Standardize internal endpoints.",
  "resourceManagerId": "b2d84ce6-35b5-4c02-a39b-4732acfe91cb"
}
```

The team must belong to the selected department; the resource manager must belong to the organization. Dates are date-only ISO strings and endDate must not precede startDate. Project details include `progress: {totalTasks, completedTasks, percent}` calculated from all project tasks. Use the project's teamId to fetch its assigned team. Status values are `todo`, `in_progress`, `done`; these API identifiers map to the display labels Todo, In Progress, Done.

`POST /organization/projects/:projectId/tasks`:

```json
{
  "name": "Audit legacy endpoints",
  "description": "Document endpoint dependencies and usage.",
  "assigneeId": "b2d84ce6-35b5-4c02-a39b-4732acfe91cb",
  "priority": "normal",
  "status": "todo",
  "startDate": "2026-10-01",
  "dueDate": "2026-10-15"
}
```

Task assignee is optional; send null to unassign. Complete with `PATCH {"status":"done"}`. Task updates and their history entries are committed together. Notes use `{ "body": "Initial audit complete." }`. Descriptions/notes are plain text: render them as text, never as unsanitized HTML. The Figma rich-text toolbar is not a rich-text HTML storage contract in this implementation.

## Actual file uploads

```javascript
const form = new FormData();
form.append('file', input.files[0]);
const response = await fetch(`${api}/api/v1/organization/tasks/${taskId}/attachments`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` },
  body: form,
});
// Do not manually set Content-Type: the browser supplies the multipart boundary.
```

Task attachments accept PDF (.pdf, application/pdf) and UTF-8 CSV (.csv, text/csv, application/csv or Excel's CSV MIME alias), at most 5 MiB. Executables, archives, SVG/HTML and unrelated image types are not task attachments. The backend checks actual byte count, extension/MIME, PDF header/end marker and obvious active-content markers, or UTF-8 text/control characters for CSV. These checks are not an antivirus scanner or a full PDF parser. Files are stored privately and are only served through short-lived download URLs, not rendered inline by the application. CSV must be treated as untrusted data, not automatically executed/imported as spreadsheet formulas.

The upload response contains an attachment id. Use its download endpoint for `{url, expiresIn:300}`. Never store the temporary download URL as a permanent file address. DELETE on a task removes its attachments through the backend before removing the task; the frontend sends one request. Individual attachments also have their own delete endpoint. Storage deletion failure retains metadata for retry. Task deletion can make partial cleanup progress before a later storage error; retry the same request. A concurrent attachment upload blocks final task deletion rather than leaving an untracked file. An ambiguous upload timeout can leave an unreferenced storage object; production cleanup should reconcile orphan paths before deleting them.

## Migration, verification and deployment

Apply `supabase/migrations/0009_organization_workflow.sql` once after 0001–0008, then deploy the backend. It creates the private attachment bucket and new tables, extends roles, grants workflow permissions to existing/future owners, and adds service-only transactional functions. No existing departments or members are deleted. This migration has not been applied to your live Supabase project by this task.

Tests include the existing unit suite, new DTO/workspace/attachment checks, Swagger contract checks, and `test/workflow.integration.sql` against local PostgreSQL using the service role. The local test bootstrap emulates Supabase's auth/storage schemas; never run `test/workflow-bootstrap.sql` in Supabase. Storage upload/download against live Supabase still requires a deployed smoke test with an authorized test account.

Remaining product boundaries: employee names/avatars are absent from the current profiles schema, so pickers currently return IDs/emails and search email. VITA suggestions, AI generation, leave/expense execution, headcount/capacity metrics and recruitment publication are not implemented by this flow. The API does not fabricate those outputs. Dropdown choices for role level/employment type were not expanded in the inspected design, so bounded text values are accepted instead of inventing a fixed catalogue.
