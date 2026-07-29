import { LifeBuoy, ShieldCheck } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getExtension } from '@/extensions/registry';

export default function SupportPage() {
  const SupportContent = getExtension('support.page-content');

  return (
    <main className="min-h-screen bg-background px-4 py-16 text-foreground">
      {SupportContent ? (
        <SupportContent />
      ) : (
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <div className="mb-4 flex size-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <LifeBuoy className="size-6 text-primary" />
            </div>
            <CardTitle>Support</CardTitle>
            <CardDescription>
              Hilfe für diese Installation erhältst du über die Dokumentation oder den Betreiber deiner Instanz.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                Über diese Seite werden keine Vault-Inhalte, Schlüssel oder Kontodaten an einen externen Dienst übertragen.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
