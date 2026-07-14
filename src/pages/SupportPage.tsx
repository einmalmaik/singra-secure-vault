import { ExternalLink, MessageCircle, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hasSupportIntegrationConsent } from '@/lib/cookieConsent';
import { openExternalUrl } from '@/platform/openExternalUrl';
import { isTauriRuntime } from '@/platform/runtime';

const SUPPORT_URL = 'https://singravault.mauntingstudios.de/support';

export default function SupportPage() {
  const desktop = isTauriRuntime();
  const consented = hasSupportIntegrationConsent();

  const openConsent = () => window.dispatchEvent(new Event('singra:open-cookie-settings'));

  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
            <MessageCircle className="size-6 text-primary" />
          </div>
          <CardTitle>Singra Support</CardTitle>
          <CardDescription>Erstelle freiwillig ein Ticket direkt über unser zentrales Discord-Supportsystem.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
            <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />Vault-Inhalte, Schlüssel und Kontodaten werden niemals automatisch übertragen.</p>
          </div>
          {desktop ? (
            <Button onClick={() => void openExternalUrl(SUPPORT_URL)} rightIcon={<ExternalLink />}>Support im Browser öffnen</Button>
          ) : consented ? (
            <p className="text-sm text-muted-foreground">Das offizielle Support-Widget ist unten rechts verfügbar.</p>
          ) : (
            <Button onClick={openConsent}>Support-Integration aktivieren</Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
