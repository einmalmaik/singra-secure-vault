import { ArrowLeft, FileSignature } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';

export type Language = 'de' | 'en';

export interface LegalSection {
  heading: string;
  body: string;
}

export interface LegalDocumentData {
  title: string;
  intro?: string;
  callout?: string;
  lastUpdated: string;
  version: string;
  sections: LegalSection[];
  meta: {
    de: string;
    en: string;
  };
}

export interface LegalDocumentViewerProps {
  document: LegalDocumentData;
  language: Language;
  onBack?: () => void;
  backHref?: string;
  footerLinks?: { href: string; label: string; isExternal?: boolean }[];
  footerCopy?: string;
}

export const LegalDocumentViewer = ({
  document,
  language,
  onBack,
  backHref = '/',
  footerLinks,
  footerCopy,
}: LegalDocumentViewerProps) => {
  const doc = document;
  const backLabel = language === 'de' ? 'Zurück zur Startseite' : 'Back to home';
  const summaryLabel = language === 'de' ? 'Kurzfassung:' : 'Summary:';
  const docLabel = language === 'de' ? 'Rechtsdokument' : 'Legal document';
  const versionLabel = language === 'de' ? 'Version' : 'Version';
  const updatedLabel = language === 'de' ? 'Zuletzt aktualisiert' : 'Last updated';

  const defaultFooterCopy =
    language === 'de'
      ? `© ${new Date().getFullYear()} Singra · MauntingStudios. Alle Rechte vorbehalten.`
      : `© ${new Date().getFullYear()} Singra · MauntingStudios. All rights reserved.`;

  const copy = footerCopy ?? defaultFooterCopy;

  return (
    <main className="min-h-screen bg-grid-fade">
      <div className="mx-auto max-w-3xl px-4 py-12 md:py-16">
        {onBack ? (
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {backLabel}
          </button>
        ) : (
          <a
            href={backHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {backLabel}
          </a>
        )}

        <Card className="mt-6 shadow-panel">
          <CardHeader className="gap-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
              <FileSignature className="size-3.5" aria-hidden="true" />
              <span>{docLabel}</span>
            </div>
            <CardTitle className="text-3xl font-bold tracking-tight">{doc.title}</CardTitle>
            <CardDescription>{doc.meta[language]}</CardDescription>
            <div className="flex flex-wrap items-center gap-2 text-xs mt-2">
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 font-mono text-foreground">
                {versionLabel} v{doc.version}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-foreground">
                {updatedLabel}: <time dateTime={doc.lastUpdated}>{doc.lastUpdated}</time>
              </span>
            </div>
          </CardHeader>

          <CardContent className="space-y-6 mt-4">
            {doc.intro && (
              <p className="text-base leading-relaxed text-foreground/90">{doc.intro}</p>
            )}

            {doc.callout && (
              <aside
                role="note"
                className="rounded-md border border-accent/30 bg-accent/10 px-4 py-3 text-sm leading-relaxed text-foreground"
              >
                <span className="font-semibold text-accent-foreground">{summaryLabel}</span>{' '}
                {doc.callout.replace(/^Kurzfassung:\s*|^Summary:\s*/i, '')}
              </aside>
            )}

            {doc.sections.map((section) => (
              <section key={section.heading} className="space-y-2">
                <h2 className="text-xl font-semibold leading-tight text-foreground mt-6">
                  {section.heading}
                </h2>
                {section.body.split('\n\n').map((paragraph, idx) => (
                  <p
                    key={idx}
                    className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground"
                  >
                    {paragraph}
                  </p>
                ))}
              </section>
            ))}
          </CardContent>
        </Card>

        <footer className="mt-10 border-t border-border pt-6 text-xs text-muted-foreground">
          {footerLinks && footerLinks.length > 0 && (
            <nav className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
              {footerLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target={link.isExternal ? '_blank' : undefined}
                  rel={link.isExternal ? 'noreferrer' : undefined}
                  className="hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
            </nav>
          )}
          <p>{copy}</p>
        </footer>
      </div>
    </main>
  );
};
