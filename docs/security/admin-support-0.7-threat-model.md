# Admin Console and Support Integration Threat Model

Status: release candidate for Singra Vault 0.7.0 / Premium 1.1.0

## Security boundaries

- The Core repository owns Vault, authentication, session, and encrypted-data
  invariants. The private Premium package owns Admin Console, billing, family,
  operational notifications, and the official support integration.
- Admin authorization is decided by the server for every read and mutation.
  Rendering an Admin route or control never grants a permission.
- Admin responses must not contain Vault plaintext, Vault or device keys,
  recovery material, raw e-mail addresses, IP addresses, user agents, or
  user-visible UUIDs.
- The browser may load the fixed Singra Bot script only after the separate
  `supportIntegration` consent and a valid public Premium configuration.
  Tauri never loads this remote script in its WebView.
- SMTP credentials, the Singra webhook secret, service-role credentials, and
  OPAQUE server material are server secrets. They are never `VITE_*` values.

## Assets and adversaries

Protected assets include Vault and authentication material, account metadata,
admin roles, audit history, SMTP credentials, support guest addresses and
messages, and operational status. Relevant adversaries include a remote
attacker, a malicious or compromised admin account, a database reader, a
replay sender, a compromised third-party script, a stolen device, and a
supply-chain attacker.

## Required controls

- RLS is deny-by-default for Admin and support tables. Narrow service-role RPCs
  validate the authenticated actor and the exact permission again.
- Critical Admin actions require a fresh one-time step-up proof, an exact
  confirmation phrase, idempotency, expiry, and an immutable audit event.
  Self-approval is forbidden whenever a second superadmin exists.
- Support webhook verification uses the exact raw body, HMAC-SHA256 via the
  platform Web Crypto API, constant-time comparison, a five-minute timestamp
  window, a fixed event schema, and an atomic unique event-id claim.
- Support payloads are processed in memory only. Persistent delivery records
  contain event type, state, and timestamps but no guest address, subject, or
  message.
- Audit data uses fixed event, outcome, detail, and reason codes. Free-form
  metadata and sensitive request data are rejected.
- Emergency mode may close registration and disable the external support
  integration. It must not modify Vault ciphertext, keys, integrity baselines,
  recovery state, or offline trust.

## Failure behavior

- Missing Admin contracts, permissions, settings, or step-up state fail closed.
- Missing or invalid support configuration means no script is loaded.
- Invalid, stale, malformed, or replayed webhooks are rejected without
  including request content in logs.
- SMTP failure returns a stable non-sensitive error and leaves the delivery
  retryable. No recovery or authentication operation is reported as complete
  solely because a UI transition succeeded.
- Service states without a trusted source are reported as `not_configured` or
  `unobserved`, never inferred as healthy.

## Compatibility and rollback

- Database migrations are additive and default new remote integrations to
  disabled. Historical support tables remain isolated until a separately
  approved retention decision.
- Core-only builds remain functional without Premium and never receive the
  official Widget configuration.
- A web rollback must be possible without reverting the additive schema.
  Previous Edge Function versions remain deployable while the new settings
  and webhook are disabled.

## Required review

This release changes authentication-adjacent mail, administrative account
actions, session revocation, and handling of support personal data. It requires
an R2 AppSec/security-architecture review before production merge. Changes to
OPAQUE, Vault encryption, key formats, or recovery cryptography are explicitly
out of scope.
