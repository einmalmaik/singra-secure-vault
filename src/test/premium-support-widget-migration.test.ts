import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260729120000_premium_support_widget.sql",
  "utf8",
);

describe("Premium support widget migration", () => {
  it("defaults the public widget off and exposes only its public fields", () => {
    expect(migration).toContain(
      "support_widget_enabled BOOLEAN NOT NULL DEFAULT FALSE",
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.get_public_support_widget_config()",
    );
    expect(migration).toContain("enabled BOOLEAN");
    expect(migration).toContain("widget_id TEXT");
    expect(migration).not.toContain("webhook_secret");
    expect(migration).not.toContain("smtp_password");
  });

  it("deduplicates atomically without persisting ticket payload or guest PII", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.singra_webhook_deliveries",
    );
    expect(migration).toContain("event_id TEXT PRIMARY KEY");
    expect(migration).toContain("ON CONFLICT (event_id) DO NOTHING");
    expect(migration).toContain("status = 'failed'");
    expect(migration).toContain("INTERVAL '10 minutes'");
    expect(migration).toContain("ALTER TABLE public.singra_webhook_deliveries FORCE ROW LEVEL SECURITY");
    expect(migration).not.toMatch(/\bguest_email\b/i);
    expect(migration).not.toMatch(/\bmessage\b/i);
    expect(migration).not.toMatch(/\bsubject\b/i);
  });

  it("keeps all support storage and RPCs service-role-only", () => {
    expect(migration).toContain(
      "FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_singra_webhook_event(TEXT, TEXT)",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.finish_singra_webhook_event(TEXT, TEXT, TEXT)",
    );
  });
});
