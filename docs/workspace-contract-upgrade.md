# Workspace contract upgrade (migration 0011)

Apply `supabase/migrations/0011_workspace_contract.sql` once, after 0010, then deploy this backend. No organization, profile, or membership data is deleted.

## Organization selection

Every employer dashboard, activity, calendar and department route now resolves the workspace from the authenticated user's membership. The organization workflow and notification routes use the same resolver. A single-workspace employer sends only `Authorization: Bearer <access_token>`, plus the ordinary request data.

Do not put `organizationId` in new single-workspace requests. Legacy body/query values remain optional and deprecated for compatibility. If a user belongs to multiple organizations, select one with `X-Organization-Id`. Conflicting selectors return 400, malformed selectors return 400, and selecting a workspace without membership returns 403. Resource IDs such as departmentId and taskId remain necessary. They are always scoped to the verified workspace.

Invited members can use employer workspace routes if their active organization roles grant the required permission. A platform employer role is no longer an additional requirement. This does not grant permissions implicitly.

```http
GET /api/v1/employer/dashboard
Authorization: Bearer <access_token>
```

```http
POST /api/v1/employer/departments
Authorization: Bearer <access_token>
Content-Type: application/json

{"name":"Engineering","description":"Product development"}
```

## Sign-in and onboarding

Sign-in and `/auth/me` share the same state builder; account-role completion and role changes now use it too.

| Field | Meaning |
|---|---|
| accountOnboardingComplete | A platform role has been selected, or the user joined a workspace |
| employerWorkspaceSetupComplete | This user completed their own employer setup |
| hasWorkspaceAccess | The user currently has at least one organization membership; individual actions still require permissions |
| organizationIds | Current memberships, not stale IDs from onboarding |
| organizationId | The single membership ID, otherwise null |
| requiresWorkspaceSelection | More than one membership |
| onboardingComplete | Application readiness: workspace membership, or an onboarded non-employer account |
| nextAction | dashboard, select_workspace, company_setup, candidate_dashboard, or select_account_role |

An invited member may have `hasWorkspaceAccess: true` and `employerWorkspaceSetupComplete: false`. Route that user into their joined workspace; do not require creating a company. Membership does not guarantee dashboard permissions: use assigned organization permissions to decide the appropriate UI.

## Safe membership editing

Prefer atomic deltas for one member:

- `PUT /api/v1/organization/departments/:departmentId/members/:userId`
- `DELETE /api/v1/organization/departments/:departmentId/members/:userId`
- `PUT /api/v1/organization/teams/:teamId/members/:userId`
- `DELETE /api/v1/organization/teams/:teamId/members/:userId`

These preserve other members and use the existing management permissions. IDs belong to existing organization members. They never grant roles.

**Full replacements now require a revision**:

```json
{"memberIds":["<existing user UUID>"],"expectedRevision":3}
```

For departments, obtain `membershipRevision` with GET department members. For teams, obtain it from GET team details or GET team members. The member list and revision come from one database snapshot. On 409, reload and reconcile; do not blindly retry with a new revision. PATCH team requests containing `memberIds` also require `expectedRevision`.

Role permission replacements similarly require `expectedRevision`, using `revision` from GET role details. PATCH role requests containing `permissionIds` must also include it. Requests missing required versions are rejected rather than overwriting changes. Read the **detail/snapshot** endpoint before full replacements; don't derive a complete team membership list from a filtered or paginated member picker.

Department transfers are atomic:

```http
POST /api/v1/organization/departments/transfer-member
```

```json
{"userId":"<existing member UUID>","fromDepartmentId":"<source UUID>","toDepartmentId":"<destination UUID>"}
```

The product currently supports multiple direct department memberships. Transfers move one direct membership. Team membership and department-linked roles remain independent: a transfer does not silently change them or grant permissions. Both membership notifications are committed together, or neither change occurs. Enforcing a single department per employee or a mandatory team-to-department membership relationship would be a separate product/data-model change, not an inferred rule.

## Email state and operations

Onboarding completion reads the welcome outbox record and returns `welcomeEmailStatus` (`pending`, `processing`, `sent`, `failed`, `suppressed`, or `not_queued`). Compatibility fields `welcomeEmailSent` and `welcomeEmailQueued` now reflect that persisted status; repeating completion does not report a false delivery state or send another welcome.

Worker endpoints support POST and GET `/api/v1/internal/notifications/process`. Use GET for schedulers that only issue GET requests. Either `NOTIFICATION_WORKER_SECRET` or `CRON_SECRET` authenticates the worker. These are server-side secrets.

`GET /api/v1/internal/notifications/health` uses the same secret and reports queue counts, oldest pending timestamp, last sent timestamp, and SMTP/frontend configuration presence. Configure your monitoring to alert on failed messages or a growing, old pending queue. An idle queue alone does not prove a worker is running. Processing prunes sent/suppressed messages older than 90 days; failed records remain for investigation.

A scheduler and real SMTP credentials still must be configured on the deployment. No production settings were changed. SMTP `sent` means provider acceptance; inbox delivery and bounces require provider-specific signed webhooks. A provider was not selected or connected here, so no unverified generic webhook was added. Delivery remains at-least-once: a crash after SMTP acceptance can cause a duplicate on retry.

## Profile and response improvements

`PATCH /api/v1/auth/profile` accepts optional `displayName` (1–120 characters) and HTTPS `avatarUrl`; null clears either field. This sets profile data, not image bytes. Member pickers now return displayName and avatarUrl alongside ID/email. Existing profiles start with null values until populated.

Workspace membership listings use `organizationId`, rather than exposing `organization_id`. New membership mutation results use camelCase.

Department icons return `builtinKey`, `url`, `imageStatus` (`builtin`, `available`, `temporarily_unavailable`), and `retryable`. The dashboard no longer exposes storage paths or throws solely because signing a preview fails. Show a placeholder for unavailable previews and retry; a built-in icon uses its builtinKey. Preview signing on department responses is limited to five seconds.

## Boundaries of this backend change

The repository contains the backend, not the Netlify frontend. The frontend still needs the invitation-token handler documented in `email-notifications.md` and the new response/revision fields above. Production end-to-end email delivery, Netlify routing, scheduler installation and provider bounce monitoring require deployment/provider access. Local tests do not establish that those live systems work.

Validation: HTTP tests cover all legacy employer routes without organization selectors, unauthorized selectors, multi-workspace selection, and optional Swagger fields. Unit tests cover invited-member readiness and stale onboarding IDs. `test/workspace-contract.integration.sql` runs after migration 0011 and verifies revisions, transfers, invitation acceptance and permissions; fixtures roll back. The earlier SQL suites target the schema through 0010 and should run before applying 0011, because unversioned full replacement requests are intentionally no longer accepted.
