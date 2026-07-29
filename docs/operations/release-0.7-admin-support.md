# Singra Vault 0.7 Admin and Support Operations

This runbook intentionally contains no credentials. Replace placeholders only
in the Supabase, Vercel, GitHub, and Singra Bot control planes.

## 1. Configure SMTP

Use one SMTP account that supports implicit TLS on port 465.

In Supabase Dashboard, open **Authentication → SMTP Settings** and configure:

- Host: provider SMTP host
- Port: `465`
- Username and password: provider credentials
- Sender address and sender name: verified Singra Auth sender

Configure the same transport for Edge Functions:

```powershell
supabase secrets set `
  SMTP_HOST="<host>" `
  SMTP_PORT="465" `
  SMTP_USER="<user>" `
  SMTP_PASSWORD="<password>" `
  SMTP_FROM="<verified sender>" `
  SMTP_SENDER_NAME="Singra Vault"
```

Do not prefix these values with `VITE_`, store them in repository files, or
paste them into Admin Console fields.

In **Authentication → Email Templates**, install the versioned templates from
`supabase/templates`. Enable the security notifications for password and
e-mail changes, linked and unlinked sign-in methods, and added or removed MFA
methods. Send one real test for every enabled template before release.

## 2. Configure Singra Bot

1. Verify `singravault.mauntingstudios.de` in the Singra Bot DNS panel.
2. Configure this public HTTPS webhook URL:

   `https://lcrtadxlojaucwapgzmy.supabase.co/functions/v1/singra-support-webhook`

3. Rotate the webhook secret in the Singra Bot panel and store it directly as:

   ```powershell
   supabase secrets set SINGRA_WEBHOOK_SECRET="<rotated secret>"
   ```

4. Deploy the Premium webhook with gateway JWT verification disabled. The
   function performs its own HMAC authentication.
5. Use **Test-Zustellung ausführen**. Confirm a successful `webhook_test` in
   Admin Console without expecting an e-mail.
6. In Admin Console, open **Globale Einstellungen → Support-Widget**, enter
   the public widget ID, save it, and enable the integration.

The widget ID is public configuration. It is not a secret and is not a build
environment variable. The webhook secret is never readable from Admin Console.

## 3. Public application configuration

Vercel production, preview, and the official desktop workflow need the matching
public values:

```text
VITE_SUPABASE_PROJECT_ID=lcrtadxlojaucwapgzmy
VITE_SUPABASE_URL=https://lcrtadxlojaucwapgzmy.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<current publishable key>
VITE_SITE_URL=https://singravault.mauntingstudios.de/
```

For GitHub Actions, maintain the equivalent `OFFICIAL_VITE_*` repository
variables. OPAQUE server material and Tauri signing keys remain GitHub secrets.

`VITE_SINGRA_SUPPORT_WIDGET_ID` is obsolete and must not be configured.

## 4. Deployment order

1. Back up the database and record the currently deployed Edge Function and
   web commit identifiers.
2. Apply the additive migrations to a non-production project and run the
   migration/security contract tests.
3. Deploy Premium Edge Functions to non-production and verify SMTP, Admin,
   webhook, Web, and Tauri behavior.
4. Obtain the human production approval recorded for this release.
5. Apply production migrations.
6. Deploy the Premium Edge Functions.
7. Merge and tag Premium `v1.1.0`.
8. Confirm the Core desktop workflow is pinned to Premium `v1.1.0`, verify
   the Core Vercel preview, and merge Core `main`.
9. Observe the Vercel production deployment and runtime errors.
10. Tag Core `v0.7.0` and observe every desktop release matrix job.

## 5. Rollback

- Disable the support widget in Admin Console before rolling back application
  code.
- Roll Vercel back to the previously verified deployment.
- Redeploy the previous Edge Function sources if a function regression exists.
- Do not reverse additive migrations or delete new tables during an incident.
- Do not auto-rebaseline Vault integrity data, bypass device-key requirements,
  or restore remote data as trusted state.
- Preserve Admin audit and webhook delivery metadata for incident review.
