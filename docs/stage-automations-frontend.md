# Stage automations: frontend integration

This change adds dedicated endpoints for the automation page and pipeline editor.
Apply `20261104190501_recruitment_stage_management.sql` after the earlier migrations,
then deploy the backend before using these routes in production. No new environment
variables are required for these endpoints.

All URLs below are relative to `/api/v1/employer` and require the signed-in user's
Bearer token. Send `X-Organization-Id` when the user belongs to multiple workspaces.
Reads require `jobs.view`; writes require `jobs.manage_all`. Closed jobs are read-only.

## Endpoints

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/jobs/:jobId/stages` | List all saved stages, ordered, with automations and real candidate counts |
| POST | `/jobs/:jobId/stages` | Add a stage at the end |
| PATCH | `/jobs/:jobId/stages/order` | Save drag/drop stage order |
| PATCH | `/jobs/:jobId/stages/:stageId` | Rename or edit one stage |
| DELETE | `/jobs/:jobId/stages/:stageId` | Delete an unused stage |
| GET | `/jobs/:jobId/stages/:stageId/automations` | Open the automation page |
| POST | `/jobs/:jobId/stages/:stageId/automations` | Add one rule |
| PATCH | `/jobs/:jobId/stages/:stageId/automations/:automationId` | Edit or toggle one rule |
| DELETE | `/jobs/:jobId/stages/:stageId/automations/:automationId` | Delete an unused rule |
| PUT | `/jobs/:jobId/stages/:stageId/automations` | Save the whole automation page atomically |

The creator determines the stage count by adding/removing stages: there is no
separate `numberOfStages` property. The maximum is 30 stages, each with up to 20
rules. Categories are `screening`, `interview`, `assessment`, `offer`, `hired`, `other`;
the creator chooses names and order, rather than being forced to use five stages.

## Frontend sequence

1. Create the job draft with `POST /api/v1/employer/jobs` and retain its returned `id`.
   For a custom empty pipeline, include `"stages": []`; omitting stages creates the
   existing default pipeline. Initial custom stages can also be included in creation.
2. GET `/jobs/:jobId/stages`. Use each stage's returned `id` as the stable key.
3. Add/rename/reorder stages using their dedicated endpoints. These do not replace
   other stages, remove candidate assignments or recreate stage IDs.
4. Select a stage and GET its `/automations`. Bind `items` to the form. Retain each
   existing rule's `id` alongside its fields; never derive the ID from its label.
5. Edit locally. Discard Changes restores the fetched data. Save Automations sends
   PUT with the complete `items` array below. This is one database transaction:
   if any item fails, none of the form changes are saved.
6. Replace local form state with the returned `items` (new rules now have IDs).
   Do not repeat a create request after saving; use the returned ID for edits.
7. Alternatively POST one new rule or PATCH one existing rule immediately.

Do not send `stages` to the legacy whole-job PATCH when editing this page. That
older collection-replacement flow recreates stages. Use the dedicated stage routes
for existing jobs. These new routes require no `expectedRevision`; each successful
write increments the job revision and records an audit entry. Concurrent saves use
last-write-wins. The returned revision is informational for this flow.

### Create a stage

POST `/jobs/:jobId/stages`

```json
{
  "name": "Technical interview",
  "category": "interview",
  "description": "Technical discussion with the engineering team",
  "accent": "#3b82f6"
}
```

Response: `{ "jobId": "...", "stageId": "new-stage-uuid", "revision": 3,
"items": [/* all stages */], "total": 6 }`.
Each stage item includes `id`, `name`, `category`, `displayOrder`, `description`,
`accent`, `isAssessment`, `assessment`, `candidateCount`, `hasEnabledAutomation`,
`automations` and stored ownership fields. A calculated zero count is returned as 0.

PATCH `/jobs/:jobId/stages/order` with every existing stage ID exactly once:

```json
{ "stageIds": ["stage-two-uuid", "stage-one-uuid", "stage-three-uuid"] }
```

Use actual UUIDs, not the illustrative strings above. For a rename, PATCH the stage
with `{ "name": "Final technical interview" }`. Stage updates do not accept an
`automations` property; use the automation endpoints.

### Add one automation

POST `/jobs/:jobId/stages/:stageId/automations`

```json
{
  "kind": "email",
  "label": "Application acknowledgement",
  "isEnabled": true,
  "config": {
    "recipient": "candidate",
    "subject": "We received your application",
    "body": "Thank you. Our team will review your application."
  }
}
```

Illustrative response (UUID placeholders must be actual IDs in requests):

```json
{
  "jobId": "job-uuid",
  "stageId": "stage-uuid",
  "automationId": "new-automation-uuid",
  "revision": 4,
  "items": [
    {
      "id": "new-automation-uuid",
      "organizationId": "organization-uuid",
      "stageId": "stage-uuid",
      "kind": "email",
      "label": "Application acknowledgement",
      "isEnabled": true,
      "config": {
        "recipient": "candidate",
        "subject": "We received your application",
        "body": "Thank you. Our team will review your application."
      },
      "createdAt": "2026-11-04T19:00:00Z"
    }
  ],
  "total": 1
}
```

GET returns the same envelope with `automationId: null`. An empty list returns
`items: []`, `total: 0` (not null).

### Toggle or edit one rule

PATCH `/jobs/:jobId/stages/:stageId/automations/:automationId`:

```json
{ "isEnabled": false }
```

Other omitted properties remain unchanged. If `config` is sent, send the whole
configuration object: it replaces the previous object rather than merging keys.

### Save the entire page

PUT `/jobs/:jobId/stages/:stageId/automations`:

```json
{
  "items": [
    {
      "id": "existing-automation-uuid",
      "kind": "email",
      "label": "Application acknowledgement",
      "isEnabled": false,
      "config": { "recipient": "candidate", "subject": "Received", "body": "Thank you." }
    },
    {
      "kind": "reviewer_assignment",
      "label": "Assign hiring team",
      "isEnabled": true,
      "config": { "reviewerRole": "reviewer" }
    }
  ]
}
```

Existing IDs are updated, omitted IDs create new rules, and omitted stored rules
are removed only when they have never executed. To stop a used rule, retain its ID
and send `isEnabled: false`; removing it would erase its history and is rejected.
Send `items: []` to clear an entirely unused stage's rules. The entire save is atomic.
Labels must be unique within the stage. PUT items accept only `id`, `kind`, `label`,
`isEnabled`, `config`; do not copy ownership/timestamp fields from GET into the body.

## Actual execution and the screenshot

Saving settings does not execute them or replay them for existing candidates.
Enabled rules run when candidate creation/stage advancement creates an entry event
for the configured stage. Existing route:
`POST /api/v1/employer/candidates/:candidateId/advance` with `{ "stageId": "..." }`.
Execution results are returned as `automations` on that mutation. The existing SQL
executor records one execution per rule and stage event, preventing duplicate runs
for the same event. Configuring rules on a draft does not make them wait for job
publication: the existing candidate-entry behavior is unchanged.

| Supported kind | Existing execution | Configuration read by executor |
| --- | --- | --- |
| `email` | Queues notification; backend attempts delivery, failures remain queued | `recipient` (`candidate` or hiring-team fallback), `subject`, `body`, optional `reviewerRole` |
| `calendar` | Creates the application's calendar event and interview record | `startsAt`, `endsAt`, `delayHours` (default 24), `durationMinutes` (default 30), `title`, `description`, `location`, `meetingUrl`, `reviewerRole` |
| `reviewer_assignment` | Assigns workspace members and notifies reviewers | `reviewerUserIds` or `reviewerRole`; falls back to hiring team/reporting manager, optional `reason` |
| `ai_evaluation` | Records `deferred`, dummy provider/model, no real score | AI is intentionally not integrated |
| `custom` | Records `skipped`, no executable provider | Stored configuration only |

This endpoint change does **not** implement every trigger pictured in Figma.
Score thresholds, automatic stage routing, delayed reminders, assessment dispatch,
interview outcome routing, offer approval/delivery, automatic onboarding initiation,
SMS, Slack, Google/Outlook sync, and candidate self-booking are not made executable
by storing arbitrary keys in `config`. Do not present them as working integrations.
A `calendar` rule creates an internal event; it does not create a Google Meet link.
An email `delayHours` is not a delayed-email scheduler. AI remains deferred.
The UI can implement local tabs/search and count saved rules from `items`; unsupported
cards should be marked unavailable until the corresponding executor is implemented.

## Errors and verification

- 400: invalid body, foreign/duplicate order IDs, limits, closed job, or deletion of history.
- 401: missing/invalid Bearer token.
- 403: missing workspace permission.
- 404: job, stage or rule not found in the requested workspace/job/stage.
- 409: conflicting stage name or automation label.

Database changes use the established workspace lock ordering, indexed ownership
lookups, and transaction-scoped writes. Reads return bounded configuration collections
rather than loading candidate cards. No new public table access is granted; the new
RPC is service-role-only and runs as SECURITY INVOKER.

Validation includes Nest DTO/Swagger tests and the rollback-only SQL script
`test/recruitment-stage-management.integration.sql`. The script tests custom stages,
stable reorder/rename, cross-job and permission rejection, create/edit/toggle,
atomic bulk save/rollback, execution on candidate advancement, protected history,
zero lists, stage/rule caps, audit recording and closed-job enforcement.
