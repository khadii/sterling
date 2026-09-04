# Platform administration and department icons

Apply migrations 0001, 0002, then 0003 in order. Do not rerun an applied migration.

## Initial superadmin

`npm run admin:prepare` configures the designated identity in the local, ignored `.env`.
`npm run admin:bootstrap` creates `kadirid9@gmail.com` (Kadiri Daniel) only if absent, saves a randomly generated initial password in `INITIAL_SUPERADMIN_PASSWORD`, and grants the non-self-assignable `superadmin` role. Existing verified accounts keep their passwords; existing unverified accounts must confirm email first. Repeated bootstrap runs do not reset passwords or duplicate role assignments. The script checks migration availability before creating an account.

Use the existing `POST /api/v1/auth/sign-in` endpoint to sign in. Use its Supabase access token for administration requests. `GET /api/v1/auth/me` returns trusted roles. Rotate the initial password, remove the bootstrap password from `.env`, and enable MFA before routine administration. Bootstrap is never run at application startup and is not an HTTP endpoint. Do not copy the initial password into Vercel, frontend variables, logs, or Git.

Global `admin` and `superadmin` roles require `department_icons.manage` to manage the catalogue. Organization-scoped `organisation_admin` and `organisation_owner` do not qualify. Public signup and role-change DTOs remain restricted to employer/job_seeker. Additional platform administrators must be assigned by a trusted operator; there is deliberately no public admin-registration route.

## Endpoints

All routes require `Authorization: Bearer <Supabase access token>`.

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/v1/reference/department-icons?page=1&limit=50` | Authenticated users; active icons only |
| GET | `/api/v1/admin/department-icons?page=1&limit=50` | Platform icon managers; includes inactive icons |
| POST | `/api/v1/admin/department-icons/upload-url` | Platform icon managers |
| POST | `/api/v1/admin/department-icons/confirm` | Platform icon managers |
| PATCH | `/api/v1/admin/department-icons/:id` | Platform icon managers |
| DELETE | `/api/v1/admin/department-icons/:id` | Platform icon managers |

Upload request:

```json
{"name":"Logistics","contentType":"image/png","fileSize":12345}
```

Upload bytes directly to the returned signed Supabase URL (or use the Supabase SDK signed-upload token). Then call confirm with `{"uploadId":"UUID"}`. Uploads expire after two hours and must belong to the confirming administrator. Confirmation is retry-safe. Only confirmed images are published to the catalogue; pending raw files never get read URLs. The private bucket has no client write policy; uploads use narrowly scoped signed URLs.

Icons accept PNG, JPEG, SVG and single-frame GIF, up to 1 MB and 256 × 256 pixels. Backend validation compares declared size/type with actual bytes, sanitizes SVG before rendering, limits pixel count, strips metadata and emits PNG. Animated images are rejected. Built-in icons return `builtinKey` with `url: null`; uploaded icons return an expiring `url` with `builtinKey: null`. The frontend maps built-in keys to its icon library. Lists are paginated, capped at 100 records.

PATCH accepts `{"name":"Logistics","active":false}`. Deactivation hides icons from new selections without deleting existing foreign-key references. Existing drafts may keep a deactivated selection. The default General icon cannot be deactivated.

DELETE permanently removes an unused icon, its upload records and stored files. Returns 204 with no body, 404 for an unknown/already deleted ID, or 409 for the default General icon or an icon referenced by departments, suggestions or onboarding drafts. Remove those references first. Requires a bearer token and the same platform admin/superadmin permission as uploads. Apply migrations 0004 then 0005 before deploying. A durable hidden deletion marker prevents new selections during Storage cleanup; if cleanup fails, the request fails and DELETE can be retried. No restore endpoint is provided. Previously soft-deleted icons are not automatically purged: call DELETE for their IDs to permanently remove them. Backups and cached copies are outside this deletion operation.

Department draft items now accept optional `iconId`; omitted values receive the General default. Suggestions include `iconId`. Workspace provisioning persists the selected UUID in `departments.icon_id` in the existing transaction; summaries include that field. This migration also seeds Design and Administration suggestions.

## Company logos and size values

New company logos have a strict 800 × 400 pixel maximum and a 5 MB input limit. They use the same single-frame image verification and safe PNG output. Existing stored logos are not retroactively changed. Invalid image input returns 400; completed onboarding cannot be modified via the draft logo endpoints.

Company sizes are `1_10`, `11_25`, `26_50`, `51_100`, `101_plus`. Migration 0003 renames historical `100_plus` selections to `101_plus` (the bucket above 51–100); no company records are deleted. Frontend submissions must use the new value after rollout.

The current NestJS throttler configuration is unchanged. No new rate-limiter or custom rate-limit header implementation was added.

## Verification

Run `npm run build`, `npm run lint -- --no-fix`, `npm test -- --runInBand`, and `npm run test:e2e -- --runInBand`.

`test/sql/supabase-stubs.sql` is exclusively for an empty disposable local PostgreSQL database, never for Supabase production. Apply it, then migrations 0001–0003, then `test/sql/platform-icons.sql` to exercise SQL authorization, draft validation, defaults, provisioning and idempotency. These tests do not emulate the hosted Storage API.
