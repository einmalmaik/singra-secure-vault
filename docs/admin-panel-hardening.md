# Admin Panel Hardening (February 2026)

## Summary

This update hardens internal admin/support execution paths and adds a manual subscription assignment workflow for authorized admins.

## Security changes

- Every `admin-support`/`admin-team` request now enforces authenticated JWT user resolution before action handling.
- Permission checks remain user-scoped (`client`), while `adminClient` is reserved for privileged data operations only.
- `requester_email` is now masked in ticket detail responses when `support.pii.read` is missing.
- Sensitive mutation paths gained additional payload validation and abuse controls.
- `set_role_permission` now rolls back changes if audit logging fails.

## New subscription workflow

- Added permission keys:
  - `subscriptions.read`
  - `subscriptions.manage`
- Added `lookup_user` action for secure user resolution by ID/email.
- Added `assign_subscription` action with:
  - admin role + `subscriptions.manage` dual check
  - audit log write (`team_access_audit_log`)
  - optional support event (`subscription_assigned`)
  - user notification email

## Frontend updates

- New component: `AdminSubscriptionAssigner`.
- Integrated into admin ticket detail view for users with `subscriptions.manage`.
- Added i18n keys in `de.json` and `en.json`.

## Verification focus

- Ticket PII masking behavior.
- Internal message visibility boundaries.
- Role/permission mutation rollback paths.
- Manual subscription assignment happy-path and failure-path service tests.
