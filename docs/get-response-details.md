# Readable GET responses

Existing endpoints, IDs, filters and response envelopes are preserved. The backend now resolves display summaries for related records, so the frontend does not need a separate request per employee, department, role or assignee.

## Employees

GET /api/v1/employer/hr/employees returns `items`, `total`, `page`, `limit`.

Example item (illustrative values):
```json
{
  "id": "b926d058-b6f8-4390-91f7-bbc6ba646438",
  "userId": "24985cbb-83e6-4f67-bc88-a47861c42524",
  "departmentId": "7c2b269b-067e-4521-a4c7-8b6b54d893ce",
  "roleId": "b1d04778-bd0b-4840-a1e8-27f1c15488c3",
  "displayName": "Ada Okafor",
  "email": "ada@example.com",
  "avatarUrl": null,
  "departmentName": "Engineering",
  "roleName": "Engineer",
  "startsOn": "2026-09-01",
  "annualSalary": null,
  "user": {
    "id": "24985cbb-83e6-4f67-bc88-a47861c42524",
    "displayName": "Ada Okafor",
    "email": "ada@example.com",
    "avatarUrl": null
  },
  "department": {
    "id": "7c2b269b-067e-4521-a4c7-8b6b54d893ce",
    "name": "Engineering"
  },
  "role": {
    "id": "b1d04778-bd0b-4840-a1e8-27f1c15488c3",
    "name": "Engineer"
  }
}
```

The single employee endpoint, GET /api/v1/employer/hr/employees/:id, retains its envelope:
`employee`, `leaveBalances`, `onboarding`, `attendance`, `pendingReviews`.
Display fields are under `employee`. Onboarding includes `buddy` when `buddyUserId` is present.

A missing saved name/avatar or missing relation remains null; the API does not invent a profile.
Annual salary remains null without payroll.view. A real saved salary of zero remains 0.

## Other affected reads

| Read | Added summaries, where corresponding IDs exist |
| --- | --- |
| HR list and /employer/hr/records/:kind/:id | employee, department, role, team, reviewer, buddy, lead, creator, decisionMaker |
| HR payroll detail lines | employee (safe identity/assignment summary only) |
| HR role statistics | roleId, role |
| Approval chains and activity approval steps | approvers / approver |
| Organization role list/detail | department, reportsTo |
| Organization team list/detail | department |
| Organization project list/detail | department, team, resourceManager |
| Organization task list/detail | project, assignee |
| Task notes/history | author / actor |
| Calendar list/detail | organizer, creator, attendees[].user |
| Activity list/detail | actor, related source-record summaries where already authorized |

Summaries are additive. Continue submitting IDs in POST/PATCH/PUT requests; do not copy a GET response wholesale into a write DTO. Request validation still rejects unrelated display fields.

## Schema and security

Swagger includes ReadRelationsDto, RelatedPersonDto, RelatedNameDto, RelatedEmployeeDto and HrEmployeeResponseDto. Response properties are distinct from the employee write DTO.

Related employee summaries contain identity and department/role names, not salary, birth date, HR notes or full employee records. Resource permission checks run before lookups. Related queries are scoped to the resolved organization; profiles are joined through that organization's memberships.

Lookups are deduplicated and batched in groups of at most 100 IDs. Independent relation queries run together, and each has a 10-second timeout. Empty results do not trigger lookups.

## Verification and deployment

No SQL migration or Supabase policy change is required. Restart the local backend after updating source.
Regression tests cover employee labels, salary permissions, safe summaries, cross-workspace isolation, repeated-ID batching, null relations, empty lists, authorization failures and preservation of nested statistics.
Live read-only checks verified the profile/membership join and populated role list/detail responses. The checked workspace had no employee/project/task records, so those populated response cases were verified using fixtures.

## Getting every HR record without query parameters

Call GET /api/v1/employer/hr/employees with the Authorization bearer token and no query string. The backend collects all matching records in internal batches, including results beyond Supabase's row cap. This also applies to the other lists served by HrService: onboarding, leave, attendance, reviews, expenses, documents, interviews, requisitions, payroll, payroll-lines, entitlements, celebrations, department-plans and team-plans.

The response remains {items, total, page, limit}. In full-list mode, page is 1 and total and limit equal the number returned (0 for an empty list).

Optional pagination is preserved: ?page=2&limit=25 returns page 2; ?page=2 alone uses 50 records per page. Filters can be supplied without pagination to return all matching records. No organization query parameter is needed for a single-workspace account. Multiple-workspace accounts still select the workspace using X-Organization-Id.

On an upstream failure the API returns an error, rather than returning an incomplete list as if it were complete.
