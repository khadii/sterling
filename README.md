# Sterling API

Sterling is a NestJS recruitment API. Supabase provides identity and PostgreSQL; NestJS owns validation, authorization, error contracts, throttling, Swagger, and application email.

## Architecture

- `auth`: email/password, one-time social onboarding, refresh, reset, confirmation, email/password updates, logout, token and role guards.
- `supabase`: public and server-only Supabase clients. The secret key never goes to a browser.
- `mail`: provider-neutral SMTP application mail with pooling, timeouts, bounded retries, and safe failures.
- `common`: shared enums, request types, Swagger error DTO, and global exception handling.
- `health`: lightweight liveness endpoint.
- `supabase/migrations`: roles, permissions, profiles, RLS, triggers, and service-only role assignment.

## Setup

1. Fill `.env` using `.env.example`.
2. Apply `supabase/migrations/0001_create_profiles.sql` using the Supabase SQL editor or CLI.
3. Enable Email and Google under Supabase Authentication providers.
4. Add `EMAIL_CONFIRM_REDIRECT_URL` and `PASSWORD_RESET_REDIRECT_URL` to the Supabase redirect allow list.
5. Add the Google OAuth client ID and secret to Supabase. They do not belong in the NestJS environment.
6. Give the frontend `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; never give it the secret key.
7. Run `npm install` and `npm run start:dev`.
8. Open `http://localhost:3000/docs`. Routes use `/api/v1` by default.

Set `ENABLE_SWAGGER=false` in production unless the documentation is intentionally public. Never expose `SUPABASE_SECRET_KEY` or commit `.env`.

## Vercel deployment

Vercel detects `src/main.ts` as a NestJS entry point and deploys the API as one Node.js Function. No separate `api/index.ts`, output directory, or custom build command is required. `vercel.json` declares the framework explicitly, and Node.js 20 or newer is required by `package.json`.

1. Push this project to GitHub, GitLab, or Bitbucket and import it into Vercel. If the repository contains the parent `hrhiring` directory, set the Vercel **Root Directory** to `sterling`.
2. Copy every key from `deployment/vercel-env.example.yml` into **Project Settings > Environment Variables**. The YAML is documentation only; do not put real secrets in it or commit them.
3. Set the variables for Preview and Production. Give Preview its own Supabase project when possible, so preview testing cannot change production users or data.
4. Set `CORS_ORIGIN` to the frontend origins as a comma-separated string. Add every frontend confirmation/reset URL to Supabase's redirect allow list.
5. Deploy and check `https://YOUR_API_DOMAIN/api/v1/health`. Swagger is disabled by the production template; enable it deliberately if required.

CLI deployment is also available:

```bash
npx vercel@latest login
npm run vercel:preview
npm run vercel:prod
```

Vercel stores its project link and downloaded environment configuration under `.vercel/`, which is ignored by Git. Use `vercel env add NAME production --sensitive` for secrets or manage them through the dashboard. Do not place `SUPABASE_SECRET_KEY` or `SMTP_PASSWORD` in `vercel.json`, YAML committed with real values, or frontend variables.

## Authentication flows

### Email/password

`POST /auth/sign-up` passes the selected self-assignable role to Supabase. A database trigger creates the profile and validated role assignment. If email confirmation is enabled, Supabase sends the confirmation email. `POST /auth/sign-in` returns the Supabase access and refresh tokens.

### Google

The frontend calls Supabase `signInWithOAuth({ provider: 'google' })`. Supabase creates a PKCE verifier in that browser, redirects through Google, exchanges the callback code, and returns a Supabase session to that same browser. The frontend sends the Supabase access token—not a Google ID token—to NestJS as a bearer token.

For a new social user, `/auth/me` returns `roles: []`. The frontend displays the account-type screen and calls the protected `/auth/complete-onboarding` endpoint once. The database transaction checks that the requested role is publicly assignable and that the user has no existing role. A returning user already has a role, so another onboarding call returns `409 Conflict`; login itself can never silently replace the role.

After onboarding, a user may deliberately switch between public account categories through `/auth/change-role`. That transaction replaces only self-assignable roles and preserves privileged roles. It cannot be used to acquire `admin`, `support`, or any role where `is_self_assignable = false`.

This keeps browser-specific PKCE state in the browser where it belongs and makes role assignment a separate, auditable onboarding operation.

### Frontend Google example

Frontend environment variables:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
VITE_API_URL=http://localhost:3000/api/v1
```

Start Google login:

```ts
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: {
    redirectTo: `${window.location.origin}/auth/callback`,
  },
});
```

On the callback page, exchange the code when your frontend framework does not do it automatically:

```ts
const code = new URLSearchParams(window.location.search).get('code');
if (code) await supabase.auth.exchangeCodeForSession(code);

const { data } = await supabase.auth.getSession();
const accessToken = data.session?.access_token;
```

Ask NestJS whether onboarding is needed:

```ts
const me = await fetch(`${import.meta.env.VITE_API_URL}/auth/me`, {
  headers: { Authorization: `Bearer ${accessToken}` },
}).then((response) => response.json());

if (me.roles.length === 0) {
  // Show the employer/job-seeker selection page.
}
```

Complete onboarding once:

```ts
await fetch(`${import.meta.env.VITE_API_URL}/auth/complete-onboarding`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ role: 'employer' }),
});
```

### Protected requests

Send the access token as `Authorization: Bearer <access-token>`. The authentication guard asks Supabase to validate the token, then loads trusted roles from `user_roles`. It never authorizes from editable user metadata.

Access and refresh tokens are intentionally returned in JSON because this is a general bearer-token API. A browser frontend must store them securely. If Sterling becomes browser-only, migrate to secure HTTP-only cookies and add CSRF protection as one coordinated change.

### Refresh and logout

`POST /auth/refresh` rotates the refresh token. `POST /auth/sign-out` revokes only the current session. Existing access JWTs remain valid until their configured Supabase expiry, so use a short access-token lifetime.

## Routes

| Method | Route                              | Status | Purpose                                                         |
| ------ | ---------------------------------- | -----: | --------------------------------------------------------------- |
| POST   | `/api/v1/auth/sign-up`             |    201 | Email/password registration                                     |
| POST   | `/api/v1/auth/sign-in`             |    200 | Email/password login                                            |
| GET    | `/api/v1/auth/google`              |    200 | Swagger-visible documentation for the frontend Google PKCE flow |
| POST   | `/api/v1/auth/complete-onboarding` |    200 | Assign a social user's initial role once                        |
| POST   | `/api/v1/auth/change-role`         |    200 | Switch deliberately between self-assignable roles               |
| POST   | `/api/v1/auth/refresh`             |    200 | Refresh session                                                 |
| POST   | `/api/v1/auth/forgot-password`     |    202 | Request reset email without account enumeration                 |
| POST   | `/api/v1/auth/resend-confirmation` |    202 | Resend signup confirmation                                      |
| POST   | `/api/v1/auth/update-password`     |    200 | Authenticated password update                                   |
| POST   | `/api/v1/auth/update-email`        |    202 | Start Supabase secure email change                              |
| POST   | `/api/v1/auth/sign-out`            |    200 | Revoke current session                                          |
| GET    | `/api/v1/auth/me`                  |    200 | Current identity and trusted roles                              |
| GET    | `/api/v1/health`                   |    200 | Liveness check                                                  |

The forgot-password and resend endpoints deliberately return generic messages to prevent account discovery.

## Adding roles

Roles are database records, so adding a role does not require changing a PostgreSQL enum. Add it in a new migration:

```sql
insert into public.roles (id, description, is_self_assignable)
values ('recruiter', 'Manages hiring for an employer', false);
```

Use `is_self_assignable = true` only for safe public account categories. Administrative roles must be assigned by an authenticated administrative workflow, never by signup or Google login. Add a TypeScript constant only when a role must be referenced in code, then protect handlers with both guards:

```ts
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('employer')
```

Permissions can be inserted into `permissions` and connected through `role_permissions` as features are added. Users can have multiple roles through `user_roles`.

## Error contract

All errors include `statusCode`, `message`, `error`, `path`, `requestId`, and `timestamp`. The API maps validation to 400, authentication failure to 401, permission failure to 403, missing accounts to 404, conflicts to 409, throttling to 429, provider outages to 503, and unexpected failures to 500. Provider/database internals are not returned for server failures. The `x-request-id` response header correlates client errors with server logs.

## Email

Supabase owns authentication emails such as confirmation and password recovery. For production, configure Custom SMTP in the Supabase dashboard because its trial sender is limited.

`MailService` handles non-authentication messages such as application confirmations, interview invitations, and employer notifications. It accepts any SMTP-compatible provider, including SES, SendGrid, Mailgun, Postmark, or a local Mailpit instance. For high-volume delivery, call the service from a durable job queue; retries inside a web request are intentionally bounded and do not replace durable queueing.

## Local authentication testing

`THROTTLE_ENABLED=false` disables Sterling's in-memory NestJS request limiter for development. Set it to `true` in production; the tighter `@Throttle()` limits on authentication endpoints then apply. This setting does not disable Supabase's own abuse protection or email quotas.

For unrestricted local email-flow testing, run Supabase locally and point `SUPABASE_URL` and its keys to the local instance. Confirmation and recovery mail is captured by local Mailpit. Supabase CLI rate limits can be adjusted in `supabase/config.toml`, including `auth.rate_limit.email_sent`, `auth.rate_limit.sign_in_sign_ups`, and `auth.email.max_frequency`; restart the local Supabase services after changes.

When using a hosted Supabase project, configure Custom SMTP and then adjust **Authentication > Rate Limits** in its dashboard. As a temporary development-only alternative, disabling email confirmation avoids a confirmation email on signup, but production projects should verify email addresses.

## Verification

```bash
npm run lint -- --no-fix
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm audit --omit=dev
```

# sterling
