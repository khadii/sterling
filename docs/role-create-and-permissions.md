# Role creation and permission updates

POST /api/v1/organization/roles creates a new role. Supply the initial permissions in this same request; no follow-up permission request is needed.

Example:
```json
{
  "name": "Team Coordinator",
  "status": "active",
  "permissionIds": ["teams.view", "teams.manage"]
}
```

The backend generates id/key and returns revision. Do not send id or expectedRevision on creation. The create schema previously included expectedRevision incorrectly; it is now only on update schemas. Old clients sending it on creation receive 400 and must remove it.

For a saved wizard draft, keep the returned id and use PATCH /api/v1/organization/roles/{roleId} for subsequent steps. Omit permissionIds when not changing permissions.

To replace permissions, send permissionIds on PATCH /api/v1/organization/roles/{roleId}, or on PUT /api/v1/organization/roles/{roleId}/permissions for an explicit replace:
```json
{
  "permissionIds": ["teams.view", "teams.manage"]
}
```
No revision is required. The write applies immediately and the response returns the next revision. For the wizard, PATCH can update permissions and other role fields in the same request.

expectedRevision is optional and works as an optimistic-concurrency token: omit it for a plain replace, or supply the revision from the latest role response to reject the write when the role changed since it was loaded. A stale write returns 409 with code ROLE_REVISION_CONFLICT and details containing roleId, expectedRevision, currentRevision (or null if unavailable), and reloadUrl. Reload the role and review the changes before resubmitting. Do not automatically overwrite using currentRevision: another edit can occur after the error response.

Every role write is recorded in organization_role_history (actor, submitted changes, previous/new revision, timestamp), so a last-write-wins overwrite is never silent. Read it with GET /api/v1/organization/roles/{roleId}/history; entries come newest first and include an actor profile.

A creation transaction conflict uses ROLE_CREATION_CONFLICT and never asks for an existing role revision. Check the role list before retrying after uncertain network/transaction failures to avoid duplicates.

Apply supabase/migrations/20261001120000_role_write_audit_trail.sql; it makes permission writes revision-optional and installs the role audit trail in one self-contained change. Regression coverage includes HTTP routing, validation, Swagger examples, revision responses, conflict details, history output, authorization, and rollback-only SQL role creation/permission replacement.

Optional DTO fields with undefined values are removed before field-presence checks. This fixes valid create requests without iconId being rejected as Invalid role icon ID, and prevents omitted fields from being treated as explicit permission replacements.

## Verified wizard sequence (2026-09-30)

The isolated PostgreSQL integration test produced:
- Create draft with initial permissions: revision 1.
- PATCH name only (permissionIds omitted): revision 2; permissions unchanged.
- PUT permissions using earlier revision 1: PT409; stored role unchanged.
- GET role: revision 2 and original permissions.
- PUT reviewed permissions using expectedRevision 2: revision 3.
- PATCH activate with permissions and expectedRevision 3: revision 4.
- Exactly one new role; all test records rolled back.

These numbers describe the test only. Always use actual response revisions.

Keep the full latest role response in frontend state after EVERY successful write.
Await each save before starting the next one. Disable Save while its request is pending.
Do not run wizard autosave and permission replacement concurrently.
When saving a non-permission step, omit permissionIds (an empty array explicitly clears all permissions).
When permissions and other role fields change together, use a single PATCH. Add expectedRevision only when you want concurrent-edit protection.
On a 409, retain the user's unsaved selection separately, reload the current server role, and let the user review before resubmitting.
