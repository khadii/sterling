# Leave organisation setup and automation discovery

Backend implementation for the leave setup screenshot and automation selectors.
These additions require migration `20261117122751_leave_setup_and_automation_discovery.sql`
and a backend deployment. They do not change the Figma file or implement frontend UI.

All endpoints use the existing Bearer token. Select the workspace with
`X-Organization-Id` where necessary. Policy/settings reads require `employees.view`,
settings writes require `employees.manage`, and automation discovery requires
`jobs.view`. The frontend must use the Nest API, never a Supabase service-role key.

## Policy by ID

`GET /api/v1/employer/leave/policies/:id`

Use the policy `id` returned by the existing policies list. Returns one full policy
object, including eligibility/assignments, allowances, accrual, carryover, request
rules, approval chain, status and revision. The response shape matches the stored
policy returned by create/update, with camelCase property names. This route uses a
primary-key lookup scoped to the organisation; it does not fetch the entire list.
A missing ID or an ID from another workspace returns 404, and insufficient permission
returns 403. Real numeric zeros and false booleans are preserved.

Illustrative subset of the full response:

```json
{
  "id": "policy-uuid",
  "organizationId": "workspace-uuid",
  "name": "Annual leave",
  "leaveType": "annual",
  "status": "active",
  "revision": 0,
  "daysPerYear": 20,
  "maxCarryover": 0,
  "allowNegativeBalance": false,
  "departmentIds": [],
  "roleIds": [],
  "blackoutPeriods": [],
  "approvalChain": [],
  "assignment": []
}
```

## Set up Leave Organisation: screen mapping

The existing GET/PATCH settings routes are extended; no second organisation setup
resource is required.

| Screenshot control | JSON field |
| --- | --- |
| Leave year start month/day | `leaveYearStartMonth`, `leaveYearStartDay` |
| Leave year end month/day | `leaveYearEndMonth`, `leaveYearEndDay` |
| Pro-rate for new starters | `proRateNewStarters` |
| Accrue based on hours worked | `accrueByHours` |
| Public Holiday tracking | `trackPublicHolidays` |
| Manager notifications | `managerNotifications` |
| Carry Forward Rules start month/day | `carryForwardStartMonth`, `carryForwardStartDay` |
| Carry Forward Rules end month/day | `carryForwardEndMonth`, `carryForwardEndDay` |

Each pair of dropdowns is interpreted as month/day, because the settings recur each
year. Months are 1–12 and days are checked against the month. February 29 is a valid
recurring selection; this API does not decide its non-leap-year execution behavior.
April-to-March leave years and December-to-March carry windows are accepted.

Frontend sequence:

1. Load `GET /api/v1/employer/leave/settings` when opening the screen.
2. Bind the dates and booleans to the form. `isConfigured: false` means the backend
   is returning unsaved defaults. GET does not create a database row. A new
   organisation starts with pro-rating off, hours accrual on, holiday tracking off,
   and manager notifications on, matching the screenshot. Existing settings stay as saved.
3. On **Save & Continue**, call `PATCH /api/v1/employer/leave/settings` with the form.
4. Wait for a successful response, use its saved values, and navigate to the next page.
   The response includes `isConfigured: true` and `updatedAt`.

Full example request (January–December year, January–March carry window):

```json
{
  "leaveYearStartMonth": 1,
  "leaveYearStartDay": 1,
  "leaveYearEndMonth": 12,
  "leaveYearEndDay": 31,
  "proRateNewStarters": false,
  "accrueByHours": true,
  "trackPublicHolidays": false,
  "managerNotifications": true,
  "carryForwardEnabled": true,
  "carryForwardStartMonth": 1,
  "carryForwardStartDay": 1,
  "carryForwardEndMonth": 3,
  "carryForwardEndDay": 31
}
```

When the form has a carry-forward window, send `carryForwardEnabled: true` alongside
its dates; no extra visible toggle is needed on this screen. An initial carry date
window must supply all four fields together. An existing window can be edited with
a partial PATCH because omitted fields are retained. Clear it by sending all four
fields as null plus `carryForwardEnabled: false`. Legacy callers can still enable
carry-forward without a date window; the returned nulls then mean no window was set.

PATCH preserves every omitted field, including false toggles. To change just manager
notifications, send `{ "managerNotifications": false }`. Invalid dates or an incomplete
new carry window return 400 and roll back the save. Defaults, false values, and null
carry-window dates are explicit in GET responses.

Implementation: four nullable date columns are added to the existing `leave_settings`
table; its RLS and service-only access remain in place. New permission-checked
`leave_settings_get` and `leave_settings_save` RPCs replace the former unrestricted
service-side settings read and full-default-overwrite save. Database constraints
validate recurring dates even if data bypasses the DTO. Existing settings values
are preserved by this migration; the new columns are initially null.

**Behavior scope:** these endpoints store and retrieve organisation configuration.
They do not introduce an hours-accrual processor, automatically prorate balances,
fetch public holidays, make the manager-notification flag govern existing delivery,
or execute year-end carry-forward transfers. The current leave calculation/request
engine does not read these organisation switches yet. Saving a setting must not be
presented as evidence those background processes have run. Per-policy days and
max-carryover values remain separate from this organisation setup form.

## Automation catalogue: available kinds and configuration fields

`GET /api/v1/employer/automations/catalog`

Use this to build the "Add automation" selector and configuration inputs. It returns
supported **types**, not the rules already configured on jobs. Each item has:

- `id`, `kind`, `name`, `description`, `group` and `trigger`.
- `status` (`ready`, `deferred`, `configuration_only`) and `executable`.
- `configFields`: `key`, `name`, `type`, `description`, `required`, and applicable
  `default`, `minimum`, `maximum`, `maxLength`, or `options`.
- `configExample`: a supported payload for the existing create/update endpoint.

Example item within `{ "schemaVersion": 1, "items": [...], "total": 5 }`:

```json
{
  "id": "email",
  "kind": "email",
  "name": "Email notification",
  "description": "Queues an email on stage entry. Delivery uses the configured notification worker; email delays are not supported.",
  "group": "communication",
  "trigger": "stage_enter",
  "status": "ready",
  "executable": true,
  "configFields": [
    {
      "key": "recipient",
      "name": "Recipient",
      "type": "string",
      "description": "candidate sends to the applicant; hiring_team sends to the job hiring team.",
      "required": false,
      "options": ["candidate", "hiring_team"],
      "default": "candidate"
    }
  ],
  "configExample": {
    "recipient": "candidate",
    "subject": "Application received",
    "body": "Thank you for applying."
  }
}
```

The actual email catalogue item also lists subject, body and reviewerRole fields.
All five kinds are described: email, internal calendar event, reviewer assignment,
AI evaluation (deferred), and custom configuration (skipped by the executor).
Neither AI credentials nor secret environment values are exposed. The catalogue
reports the current executor's capabilities; it does not add new trigger behavior
from the other cards in the screenshot.

## Configured automations: all or enabled only

- `GET /api/v1/employer/automations`: all configured rules in the selected workspace.
- `GET /api/v1/employer/automations/enabled`: configured rules where `isEnabled` is true.
- `GET /api/v1/employer/automations?enabled=false`: disabled rules only.

Both list routes accept `jobId`, `stageId`, `kind`, `page`, `limit`. The all-rules
route also accepts `enabled=true|false`; other boolean spellings return 400.
For the selected stage's enabled rules, use:

`GET /api/v1/employer/automations/enabled?jobId=<uuid>&stageId=<uuid>`

Omit page and limit to return all matching rules. With pagination, `limit` is 1–200;
page alone uses 50 per page. Results are ordered newest first, then by ID. Responses
have `{ "items": [...], "total": 0, "limit": null, "offset": 0 }` (total reflects
matches, not just the page). Empty results use `items: []`, `total: 0`.

Each configured item includes `id`, `kind`, `label`, `isEnabled`, the saved `config`,
`jobId`, `jobTitle`, `stageId`, `stageName`, `stageCategory`, `stageOrder`, `createdAt`.
Join `item.kind` to catalogue `item.id` to label the rule and render its config fields.
An enabled AI rule is still **deferred**; an enabled custom rule is still **skipped**.
Enabled means the creator selected the toggle, not that all integrations are executable.

Existing per-stage POST/PATCH/PUT endpoints still save the rules; consult
[the stage automation guide](stage-automations-frontend.md) for those payloads.
Do not send the read-only job/stage/timestamp fields from this list back in a save.

The new list uses tenant-scoped joins and an organisation/enabled/created-at index.
Counts and paged rows share one filtered CTE instead of separate client requests.
Policy and settings lookup use their existing primary keys. Every new RPC runs as
SECURITY INVOKER and is executable only by service_role; API permissions are checked
in the database as well as authentication in Nest.

## Validation

- `src/leave/leave-http.spec.ts`: policy/settings HTTP routing, validation and Swagger.
- `src/leave/leave.service.spec.ts`: zero/false preservation and RPC error mapping.
- `src/recruitment/recruitment.spec.ts`: list filters, catalogue, HTTP and Swagger.
- `test/leave-setup-automation-discovery.integration.sql`: rollback-only SQL tests
  for full/partial settings saves, real calendar dates and carry windows, policy
  detail, enabled/disabled filters, saved config, pagination and workspace permissions.
