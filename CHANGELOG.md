# Changelog

## [SECURITY]
- Hardened `admin-support` authorization flow with strict JWT-first processing and support-console access gating (`support.admin.access` + internal role check).
- Enforced full payload validation for sensitive fields (`ticket_id`, `user_id`, `tier`, `reason`, `search`) to reduce abuse and malformed input paths.
- Added PII masking in ticket detail responses when `support.pii.read` is missing.
- Added abuse controls for support replies and manual subscription assignments with request-rate throttling.
- Removed `hasRole(adminClient, ...)` usage in `admin-team` privilege logic to avoid service-scope permission evaluation.
- Added audit-failure rollback behavior to `set_role_permission` so permission changes are reverted if audit persistence fails.

## [BUGFIX]
- Fixed inconsistent ticket status transition handling by validating allowed workflow transitions server-side.
- Fixed possible stale ticket-detail updates in `AdminSupportPanel` by guarding asynchronous detail loads with request sequencing.
- Extended admin access computation to include moderator role for support console visibility.

## [FEATURE]
- Added subscription permission keys:
  - `subscriptions.read`
  - `subscriptions.manage`
- Added migration `20260219194000_add_subscription_team_permissions.sql` to seed subscription permissions and role mappings.
- Added new admin support actions:
  - `lookup_user`
  - `assign_subscription`
- Added manual subscription assignment UI component: `src/components/admin/AdminSubscriptionAssigner.tsx`.
- Integrated subscription assignment section into ticket detail view for authorized admins.
- Added service API support:
  - `lookupAdminUser()`
  - `assignUserSubscription()`

## [REFACTOR]
- Extended shared service types in `adminService.ts` for subscription assignment and lookup payloads.
- Updated admin page permission checks to rely on `can_access_admin` for support tab visibility while keeping team-management flows admin-scoped.
- Expanded translation dictionaries (`de`, `en`) for subscription assignment workflow texts and subscription permission category labels.
