# Recruitment jobs: backend flow and testing

This documents what the jobs module implements, how each screen in the design
maps onto API calls, what every returned statistic means, and how to test it.

## What is implemented

`src/recruitment` owns the employer jobs surface. It reads and writes only
through service-role SQL functions in
`supabase/migrations/20261009120000_recruitment_jobs.sql`, so authorization is
enforced in the database as well as by the bearer-token guard.

Schema:

| Table | Purpose |
| --- | --- |
| `jobs` | Job posting: role/department/team links, reporting manager, employment type, work arrangement, seniority, experience minimum, education, primary tooling, review SLA, location, salary range, positions, status, public slug, revision |
| `job_responsibilities` | Ordered key responsibilities |
| `job_qualifications` | `must_have` / `preferred` requirements |
| `job_skills` | Skill tags with level and required flag |
| `job_screening_questions` | Screening prompts with kind, threshold, weight, knockout flag, expected answer |
| `job_pipeline_stages` | Ordered stages with category, accent and structured assessment configuration |
| `job_stage_automations` | Per-stage automations (email, calendar, AI evaluation, reviewer assignment, custom) |
| `job_publishing_channels` | Careers page, global syndication, internal mobility, premium boost |
| `candidates` | Applications with source, match score, status and current stage |
| `candidate_stage_events` | Append-only stage and status history |
| `job_interviews` | Interview records linked to calendar events, used for interview metrics |
| `job_revision_history` | Audit trail for every job write |

Every table is service-only: row level security is enabled, `anon` and
`authenticated` are revoked, and only `service_role` is granted access.

## Screen to endpoint mapping

### Jobs dashboard

`GET /api/v1/employer/jobs/metrics?date=YYYY-MM-DD`

| Screen element | Response field |
| --- | --- |
| Open Jobs (with its month-over-month delta) | `summary.openJobs`, `summary.openJobsChange` |
| Total Applications (with its percentage delta) | `summary.totalApplications`, `summary.applicationsChangePercent` |
| Candidates in Review | `summary.candidatesInReview` |
| Offers Extended | `summary.offersExtended` |
| Applications by Source donut | `applicationsBySource[]` with `count` and `percent` |
| Hiring Pipeline Overview | `pipeline[]` keyed `applied`, `screening`, `assessment`, `interview`, `offer`, `hired` |
| Interviews This Week card | `interviews.today`, `interviews.thisWeek`, `interviews.overdue` |
| Recent Activity | `recentActivity[]` |

`date` defaults to today in the workspace timezone.

### Jobs list

`GET /api/v1/employer/jobs?status=&departmentId=&search=&page=&limit=`

The response adds per-row `applicationCount`, `newApplicationCount`,
`hiredCount` and `stageCount`, so the table renders "Applicants / New" without
extra requests. Omit `page` and `limit` to receive every matching job.

The tabs map to `status`: All (omit), Open (`open`), On Hold (`on_hold`), Closed
(`closed`), Draft (`draft`).

### Create job, step 1: Job Details

`POST /api/v1/employer/jobs` with:

```json
{
  "title": "Senior Product Designer",
  "roleId": "…", "departmentId": "…", "teamId": "…",
  "reportingManagerId": "…", "reference": "JOB-0012",
  "summary": "…", "employmentType": "full_time",
  "workArrangement": "hybrid", "seniorityLevel": "Senior (L4)",
  "experienceMinYears": 5, "educationRequirement": "Degree or equivalent",
  "primaryTooling": "Figma mastery", "reviewSlaHours": 24,
  "locationCountry": "NG", "locationCity": "Lagos",
  "salaryMin": 120000, "salaryMax": 150000, "currency": "USD",
  "positions": 2,
  "responsibilities": [{ "body": "Design token systems scaling" }],
  "qualifications": [{ "kind": "preferred", "body": "WCAG AA familiarity" }],
  "benefits": [{ "label": "Comprehensive Health Insurance" }],
  "hiringTeam": [{ "userId": "…", "roleLabel": "Hiring Lead", "isLead": true }]
}
```

Every collection is optional and replaces the stored collection when present.
Country and currency are normalised to upper case. `seniorityLevel` is free text
because the designs show both "Senior (L4)" and "L4 - Senior".

### Create job, step 2: ATS & Screening

Same endpoint, add:

```json
{
  "skills": [{ "name": "Figma", "level": "expert", "isRequired": true }],
  "screeningQuestions": [{
    "prompt": "How many years of SaaS product design experience?",
    "kind": "number", "threshold": "5+ years", "weight": 50,
    "isKnockout": false, "isRequired": true, "expectedAnswer": "5"
  }]
}
```

`kind` is one of `number`, `boolean`, `short_answer`, `url`. `expectedAnswer` is
only returned to viewers who can manage or view candidates.

### Create job, step 3: Hiring process

```json
{
  "stages": [
    { "name": "Screening", "category": "screening",
      "automations": [{ "kind": "email", "label": "Send acknowledgement email", "isEnabled": true }] },
    { "name": "Interview", "category": "interview" },
    { "name": "Assessment", "category": "assessment", "isAssessment": true,
      "assessment": { "durationMinutes": 45, "format": "2 challenges", "pointsTotal": 50, "passingPercent": 80 } },
    { "name": "Offer", "category": "offer" },
    { "name": "Hired", "category": "hired" }
  ]
}
```

Stages are replaced as an ordered set, and `display_order` comes from array
position. Omitting `stages` on create installs the default
Screening → Interview → Assessment → Offer → Hired set. Assessment questions and
AI scoring are deliberately not stored yet: those belong to the assessment
module that ships with the AI integration.

### Create job, step 4: Review & Publish

`GET /api/v1/employer/jobs/:id` returns the whole bundle for the review screen:
the job row plus `responsibilities`, `qualifications`, `skills`,
`screeningQuestions`, `benefits`, `channels`, `hiringTeam`, `stages` (with
`automations` and `hasEnabledAutomation`), `stageCount`, `automatedStageCount`,
`automationPercent`, `revision` and `positionSummary`.

```json
{ "channels": [
  { "channel": "careers_page", "isEnabled": true },
  { "channel": "global_syndication", "isEnabled": true },
  { "channel": "internal_mobility", "isEnabled": true },
  { "channel": "premium_boost", "isEnabled": false }
] }
```

`POST /api/v1/employer/jobs/:id/publish` then moves the job to `open` and sets
`publishedAt`, `postedOn` and a stable `publicSlug` for the careers URL. A job
needs at least one stage to publish.

### Job detail page

`GET /api/v1/employer/jobs/:id/stats`

| Screen element | Field |
| --- | --- |
| Total Applications | `totalApplications` |
| Reviewed | `reviewed` |
| Interviewed | `interviewed` |
| Rejected | `rejected` |
| Offers | `offers` |
| Positions / Filled / Open | `totalPositions`, `filledPositions`, `openPositions` |
| Hiring Pipeline Overview | `byStage[]` with `candidateCount` |

`0` is a real value here. `filledPositions` counts hired candidates and
`openPositions` is `positions - hired`, floored at zero.

### Pipeline board

`GET /api/v1/employer/jobs/:id/pipeline?limit=50`

Returns `stages[]`, each with its configuration and up to `limit` candidate cards
ordered by most recent activity. The separate
`GET /api/v1/employer/jobs/:id/candidates` endpoint backs the applications table
with `jobTitle`, `stageName` and `stageCategory` joined per row.

### Candidate actions

```json
POST /api/v1/employer/jobs/:id/candidates
{ "fullName": "Sarah Johnson", "email": "sarah.johnson@example.com",
  "source": "linkedin", "currentRole": "UX Designer",
  "currentCompany": "Google", "matchScore": 94 }
```

`POST /api/v1/employer/candidates/:id/advance` with `{ "stageId": "…" }` derives
the candidate status from the destination stage category (`interview`,
`assessment`, `offer`, `hired`, otherwise `in_review`). Supply `status` and
`rejectionReason` explicitly to reject someone, and `note` to record context in
the stage history.

## Statistic definitions

- `openJobs` counts jobs with status `open`. `openJobsChange` compares jobs posted
  in the last 30 days with the 30 days before that.
- `applicationsChangePercent` compares the last 7 days with the 7 days before
  them, and is `null` when the earlier window has no applications.
- `candidatesInReview` counts `in_review`, `offersExtended` counts `offer`, and
  `hiredTotal` counts `hired`.
- `pipeline.applied` is the total candidate count, so the funnel always starts
  from the same number as the applications table.
- `interviews.today` and `interviews.thisWeek` count scheduled interviews whose
  calendar event overlaps the workspace-local day and week. `overdue` counts
  scheduled interviews whose event has already ended.
- `automationPercent` is the share of stages with at least one enabled
  automation, and is `null` while a job has no stages.
- `applicationsBySource[].percent` is that source's share of all applications,
  and is `null` only when there are none.

## Performance

The dashboard, job detail, pipeline and both list endpoints are single SQL
functions rather than request fan-out, and every predicate is index backed:

- `jobs_org_status_posted_idx` for status tabs and posted-date ordering.
- `candidates_org_job_status_idx` and `candidates_org_stage_idx` for per-job and
  per-stage counts.
- `candidates_org_applied_idx` and `candidates_org_activity_idx` for the 7-day
  windows and most-recent-activity ordering.
- `job_pipeline_stages_job_idx` and `job_stage_automations_stage_idx` for the
  pipeline board aggregate.
- `organization_activities_timeline_idx` for recent recruitment activity.

`recruitment_job_list` and `recruitment_candidate_list` compute their per-row
counts with `LEFT JOIN LATERAL` aggregates, so a page of N jobs costs one round
trip instead of N.

## Configuration

Recruitment provider integrations are optional and live only in the API
environment (`.env`, `.env.example`, `deployment/vercel-env.example.yml`):

```env
PUBLIC_JOB_BOARD_URL=
INTERVIEW_SCHEDULING_PROVIDER=
INTERVIEW_SCHEDULING_BASE_URL=
JOB_SYNDICATION_PROVIDER=
JOB_SYNDICATION_API_KEY=
JOB_SYNDICATION_FEED_URL=
AI_PROVIDER=
AI_API_KEY=
AI_MODEL=
```

None of them are required to create, publish or track a job. They are reserved so
vendor values can be added without a code change when interview scheduling, job
syndication and the AI features land. Never expose these to the frontend.

## Testing

Unit and contract tests:

```bash
npm run lint -- --no-fix
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

`src/recruitment/recruitment.spec.ts` covers payload validation, error mapping,
revision conflicts, unpaginated accumulation and the Swagger routes.

Database integration test, on a disposable local PostgreSQL:

```bash
createdb sterling_test
psql -d sterling_test -f test/sql/supabase-stubs.sql
for f in $(ls supabase/migrations/*.sql | sort); do psql -v ON_ERROR_STOP=1 -q -d sterling_test -f "$f"; done
psql -v ON_ERROR_STOP=1 -f test/recruitment.integration.sql
```

It provisions a workspace, creates a job with the full wizard payload, checks the
detail bundle and default channels, publishes it, moves a candidate through two
stages, verifies the dashboard, job statistics, pipeline board, list filters and
counts, confirms `expectedRevision` conflicts are opt-in, and proves another
tenant and the browser roles cannot read or write anything.
