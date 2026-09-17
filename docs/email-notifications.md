# Email notifications: backend and deployment guide

After migration 0011, follow [workspace-contract-upgrade.md](workspace-contract-upgrade.md) for revision-required membership replacements, atomic member changes, automatic workspace selection, and persisted email status.

## Apply and enable

1. Apply `supabase/migrations/0010_notifications.sql` in Supabase SQL Editor **after migrations 0001–0009**. Apply it once. Existing business tables are preserved. No historical notification flood is generated.
2. Apply migrations `0011_workspace_contract.sql` and `0012_notification_delivery.sql` in order. Migration 0012 fixes duplicate default permission grants during workspace provisioning and adds organizer RSVP notifications. Deploy this backend together with the migration. The changed onboarding response assumes the migration is installed.
3. Configure application SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
4. Set `NOTIFICATION_FRONTEND_URL` to a real frontend entry URL, e.g. `https://huppr.netlify.app`. Production requires HTTPS. This entry page must handle the invitation fragment described below.
5. Generate `NOTIFICATION_WORKER_SECRET` (at least 32 random characters) and keep it server-side. Configure `NOTIFICATION_API_URL` on the worker, e.g. `https://YOUR-API/api/v1`.
6. Run a separate long-lived process with `npm run notifications:worker`. For a scheduled job, run `npm run notifications:worker -- --once` every minute. The backend must already be running. A worker can also call `POST /api/v1/internal/notifications/process` with `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>` every minute. On serverless hosting use an external scheduler or separately hosted worker; an in-process timer will not reliably run after requests finish. Do not expose this secret to the frontend.

No Supabase Auth email settings or deployed scheduler were changed by this implementation. Supabase's Auth SMTP and the application's SMTP are configured separately, even when they use the same provider.

## Implemented triggers

| Event | Recipient | Delivery |
|---|---|---|
| Workspace provisioned successfully | Workspace creator | Essential |
| Organization invitation | Invited email address | Essential, 7-day acceptance link |
| Invitation accepted | Inviter and joining member | Essential |
| Direct department membership added/removed | Affected member | Essential |
| Organization role assigned/revoked | Affected member | Essential |
| Assigned role permissions, department, or reporting manager changed | Assigned members; new reporting manager when changed | Essential |
| Team member added/removed | Affected member | Essential |
| Project manager assigned/reassigned | New and previous manager | Essential |
| Project created, assigned to a different team, deadline/status changed | Current team and manager, excluding actor | Activity |
| Task assigned/reassigned/unassigned | New and previous assignee | Essential |
| Task status/deadline changed, deleted, note added | Assignee and project manager, excluding actor | Activity |
| Task due tomorrow/today | Assignee | Reminder, once per local date |
| Task overdue | Assignee and project manager | Reminder, once per local date |
| Calendar attendee invited/removed, event time/location/link/title changed or event deleted | Affected attendees | Essential |
| Existing attendee changes RSVP to accepted/declined | Event organizer, excluding their own response | Activity |
| Event starts within one hour | Non-declined attendees | Reminder, once per event start time |

Task dates use the organization timezone; UTC is the fallback. Daily activity is eligible at 09:00 UTC the following day. A worker batches eligible activity for the same recipient and organization into a summary, up to five queue records per processing call. Large digests can span multiple messages. Essential access emails do not obey the routine-activity opt-out.

Draft saves, unchanged membership/grant replacements, ordinary uploads and icon changes do not send emails. Team membership and direct department membership are separate relationships: adding a team member does not implicitly assign a department role or grant any permissions. Use the atomic department-transfer endpoint to remove the source membership and add the destination membership in one transaction; the affected member receives both change notices. A role's department change is reported as a role change, not a direct department membership change.

There is no blocked task status or structured mention feature in the current task model, so those events are not fabricated. Adding those features later needs corresponding notification events. Authentication confirmation, reset and email-change requests continue using Supabase Auth. Enable password-changed/email-changed and applicable identity/MFA security notifications in Supabase Authentication email settings; do not duplicate those with application templates.

## Frontend endpoints

All public routes below require the user's Supabase access token. For organization-scoped requests the backend selects the only workspace automatically; use `X-Organization-Id` only for multiple memberships. Organization IDs never bypass membership and permission checks.

### Invite a colleague

`POST /api/v1/organization/invitations`

Requires **both** `members.invite` and `roles.assign`; inviting with a department also requires `departments.manage`. Roles must be active custom roles within this organization and must not exceed the inviter's delegable privileges. System roles cannot be assigned through invitations.

Example Value (replace UUIDs with existing IDs):

```json
{
  "email": "colleague@example.com",
  "roleIds": ["b53d604c-856f-4ce8-a44d-af0a49cb19a1"],
  "departmentId": "0a434c34-21c1-44c4-938f-7986ca2b4583"
}
```

Schema: `email` required email string; `roleIds` required unique UUID array, 1–20 entries; `departmentId` optional UUID. Response contains server-generated `id`, `email`, `status: "pending"`, `expiresAt`, and `emailStatus: "queued"`. Reinviting revokes the old pending link. `queued` does not mean delivered.

`GET /api/v1/organization/invitations?page=1&limit=20` lists status for users with `members.invite`. An expired invitation remains `pending` in this list; use `expiresAt` to display expiry. `DELETE /api/v1/organization/invitations/:invitationId` revokes a pending invitation.

### Accept an invitation

The email points to the configured frontend URL with `?organizationId=<id>#invitationToken=<opaque token>`. The frontend must:

1. Read and retain the fragment token across signup/login/confirmation; remove it from the visible address using `history.replaceState`. Do not log it or send it to analytics.
2. Ask the person to sign in or verify an account using the invited email address.
3. Send `POST /api/v1/organization/invitations/accept` with the user access token and body:

```json
{ "token": "<64-character token from invitationToken>" }
```

The backend checks the **verified Supabase account**, expiry, revocation and the inviter's current privileges; it creates membership, assigns roles and optionally adds department membership in one transaction. A wrong account cannot accept. Repeating acceptance with the same account is safe. Response:

```json
{ "organizationId": "<server organization UUID>", "status": "accepted" }
```

`GET /api/v1/organization/workspaces` lists the signed-in user's workspace memberships for subsequent sessions. An invited member does not need to create their own employer workspace. Do not use the employer-owner onboarding status alone to force invited members into company setup. Organizational permissions continue to come from organization roles, not platform role names in the sign-in response.

### Set direct department members

`PUT /api/v1/organization/departments/:departmentId/members`

```json
{ "expectedRevision": 0, "memberIds": ["6590f7d4-a0ae-41f5-97e6-e7ddf04ad274"] }
```

Schema: required `expectedRevision` from the latest membership read; required unique UUID array, maximum 200, existing organization members only. **This replaces the complete direct member list**. `[]` removes everyone. Requires `departments.manage`. Only differences generate mail; unchanged members are retained. This does not grant permissions or update team memberships.

`GET /api/v1/organization/departments/:departmentId/members` returns `departmentId`, `memberIds`, and `membershipRevision`; requires `workspace.view`.

### Email preferences

`GET /api/v1/notifications/preferences`

`PATCH /api/v1/notifications/preferences`

```json
{ "activityEmail": "daily", "reminders": true }
```

Schema: both fields optional on PATCH. `activityEmail` is `immediate`, `daily` or `off`; `reminders` is boolean. Defaults are `immediate` and `true`. Changes affect only the current user. Already queued activity/reminders are suppressed when opted out before claiming. Changing immediate to daily does not retroactively reschedule existing records.

### Onboarding completion response

After migration 0011, completion returns persisted `welcomeEmailStatus`. `welcomeEmailSent` is true only for `sent`; `welcomeEmailQueued` is true for `pending` or `processing`. Repeating completion does not create another queue entry. SMTP acceptance still is not proof of inbox delivery.

## Delivery reliability and operations

Writes and outbox inserts commit together. Role/team changes compare before/after state rather than reacting to delete/reinsert churn. SMTP runs only in the worker. Workers claim records with `FOR UPDATE SKIP LOCKED`, five-minute leases and a maximum of six attempts with exponential backoff. Dead workers' leases can be reclaimed. Failed records remain for operator inspection. Recipient email addresses are resolved from the current verified Auth account at delivery time. Revoked/accepted invitation emails, removed workspace members, opted-out activity and stale task/event reminders are suppressed before claiming. Task, project and calendar recipients must still hold the corresponding view permission; assignment alone does not grant it.

This is **at-least-once delivery**: an SMTP success followed by a crash before acknowledgement can cause a duplicate. `sent` means the SMTP provider accepted the email, not proof of inbox delivery. Bounce/complaint webhooks are provider-specific and are not configured here. Access removal after a record is claimed may race with sending; messages contain minimal context and all frontend/API access is checked again. Outbox content is service-only, including invitation tokens, which are removed after successful send. Use an operations retention policy for terminal records.

Read-only status query in Supabase SQL Editor:

```sql
select status, count(*) from public.notification_outbox group by status;
select id, kind, status, attempts, available_at, sent_at, last_error
from public.notification_outbox
order by created_at desc limit 100;
```

After fixing the mail provider, an operator may retry a **specific** failed message:

```sql
update public.notification_outbox
set status = 'pending', attempts = 0, available_at = now(), last_error = null
where id = '<message UUID>' and status = 'failed';
```

Do not broadly replay sent invitation messages. Prefer creating a fresh invitation if a link expired. Deployments need enough execution time for SMTP (or run the worker against an always-on backend); the script uses a 120-second HTTP limit. Never put production SMTP credentials or worker secrets in source control.

## Validation

- Jest tests exercise verified recipient lookup, SMTP failures, daily grouping, organization isolation, invitation token handling and worker authentication.
- `test/notifications.integration.sql` runs against an isolated PostgreSQL instance after all migrations and rolls back fixtures. It verifies membership deltas, permissions, invitations, transaction rollback, preferences, reminder deduplication/staleness, leases and retry limits.
- `test/workflow.integration.sql` remains a regression check for the existing workflow transaction.
- No real emails are sent by these tests. Validate delivery with a staging SMTP inbox before production enablement.

## September 17 verification and remaining setup

The local environment checked during this audit had no SMTP host/credentials, notification frontend URL or worker configuration. That environment cannot deliver application email until configured. This does not establish the state of Vercel or Supabase production settings.

- `test/notification-delivery.integration.sql` exercises the real `provision_employer_workspace` RPC, repeat completion, failed/incomplete setup, welcome claim/acknowledgement, and RSVP changes/preferences after migrations 0001–0012.
- The worker's `processed`, `sent`, and `retryOrFailed` counters count outbox records, including multiple records combined into one digest email.
- No in-app notification inbox, provider bounce/complaint webhook, or deployed scheduler is included. SMTP acceptance is not proof of inbox delivery.
- Remaining optional event coverage: project team removal notices to the previous team, task attachment/priority changes, and notices to a previous reporting manager. Existing assignment/access, due-date and event notifications are listed above. Generic file uploads and draft saves intentionally do not generate mail.

After applying migrations, configure the variables in **Apply and enable** and start the worker. Inspect the protected `GET /api/v1/internal/notifications/health` endpoint and outbox status query. A real inbox test is still required using an authorized test recipient; automated tests send no real email.
