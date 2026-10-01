# Supabase conflict retry incident — 27 September 2026

## Cause and repair

Business-level revision conflicts raised PostgreSQL SQLSTATE 40001. PostgREST 14.5 interpreted these as retryable serialization failures, repeatedly executing the same stale workflow update. Ten occupied API connections prevented schema-cache loading and normal requests returned PGRST002/503.

Migration `20260927111953_fix_nonretryable_business_conflicts.sql` changes only the custom conflict raises in eight functions to PT409 (HTTP 409). Revision, permission, upload-expiry and Zoom concurrency checks remain enforced. Function definitions preserve their existing security attributes and grants.

The backend's three Supabase clients use `db: { retry: false }`. Error mappers recognize PT409 and retain legacy 40001 handling. Stale requests therefore reach callers without automatic database request replay.

Reference: [Supabase's documented PostgREST retry issue](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

## Production verification

Applied to project qqqntzkmlmmxfevkxizb. Supabase recorded version 20260927111953; the local filename matches.
Backend deployed to https://sterling-liard.vercel.app (deployment dpl_uF4zEzMvSvqY8EUUrsEFBgFqb6aZ).

- Live functions: eight PT409 conflict guards; zero custom 40001 raises remain.
- The ten previously stuck sessions disappeared after migration; targeted termination found no remaining matching sessions.
- Direct icon Data API read: HTTP 200.
- Deliberately stale role update: HTTP 409 / PT409 in 1.557 seconds. Negative revision forces rejection before mutation.
- Production /docs: HTTP 200. Protected reference icons endpoint without credentials: prompt HTTP 401 (not an authenticated end-to-end UI test).
- Postgres logs from 11:21:00–11:28:25 UTC: zero 40001 errors.
- Final metrics: pg_up=1, connection pool waiting=0, available=1. Schema cache success count increased to 32. Failure counters are cumulative historical totals.

## Tests

144 Jest tests passed across 25 suites; production build passed. The final test-only lint correction passed focused tests and ESLint.
All migrations applied successfully to an isolated PostgreSQL 18 instance.
SQL regressions passed for workspace membership/permissions, HR workflows, all eight repaired conflict paths, stale onboarding drafts and expired icons. Fixture transactions roll back; the temporary database server was stopped afterward.

## Frontend handling

On HTTP 409, reload the resource and its current revision, reconcile the user's changes, then submit a new request using the returned revision. Do not automatically replay the unchanged stale payload.

Restart a running local NestJS process to load the backend client changes. No additional SQL paste is needed for this live project.

## Migration history caveat

The live migration table contains this repair; older schema migrations appear to have been installed outside CLI migration tracking. Do not run a blanket `supabase db push` until existing migration history has been reconciled against the actual schema. Replaying the initial create-table migrations would fail.

## Separate advisor findings

These checks were informational follow-up, not the cause of the retry outage, and were not changed by this repair:
- [Mutable function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable): three helpers.
- [Public execution grants on security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable): seven findings requiring inspection of trigger versus callable functions before changing grants.
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys): 64 informational findings; choose indexes from workload evidence.
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection): disabled.
- RLS-without-policy notices cover backend-only tables; do not add public policies merely to silence the advisor.
