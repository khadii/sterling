# Welcome and starting onboarding

Apply migration `0006_start_employer_onboarding.sql` before deploying.

`GET /api/v1/employer/onboarding` returns `currentStep: 0`, `nextAction: "welcome"`, and `startedAt: null` for a not-started employer. Welcome is not included in the four form steps or progress percentage.

When Get started is clicked, call `POST /api/v1/employer/onboarding/start` with `Authorization: Bearer <access_token>`. No request body is required. It returns HTTP 200 and the same state shape as GET: a newly started employer has `status: "in_progress"`, `currentStep: 1`, `nextAction: "company_setup"`, and zero percent progress.

Use the returned state for navigation. Repeated requests preserve the current step, completed steps, revisions and initial start timestamp, including for completed onboarding. Only employers may call this endpoint. Existing draft-save clients can still start without this call; their first status transition records startedAt automatically. Existing in-progress/completed users retain their progress; their historical startedAt is approximated from the last saved timestamp.

The database keeps form steps numbered 1–4. Step 0 is the API representation of persisted not_started status. No rate-limiting configuration changes were made.
