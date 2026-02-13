/**
 * @fileoverview Landing Page
 * 
 * Public landing page showcasing Singra PW features.
 */

import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { SecurityFeatures } from '@/components/landing/SecurityFeatures';
import { Features } from '@/components/landing/Features';
import { PWASection } from '@/components/landing/PWASection';
import { OpenSource } from '@/components/landing/OpenSource';
import { Comparison } from '@/components/landing/Comparison';
import { Footer } from '@/components/landing/Footer';
import { SEO, createWebsiteStructuredData, createSoftwareAppStructuredData } from '@/components/SEO';

export default function Landing() {
  const structuredData = {
    ...createWebsiteStructuredData(),
    ...createSoftwareAppStructuredData(),
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SEO
        title="Sicherer Zero-Knowledge Passwort-Manager"
        description="Singra PW ist ein sicherer Zero-Knowledge Passwort Manager mit clientseitiger Verschlüsselung. Kostenlos, Open Source, und mit voller Kontrolle über deine Daten."
        path="/"
        keywords={[
          'Passwort Manager kostenlos',
          'Passwortmanager Open Source',
          'Zero-Knowledge Encryption',
          'Sichere Passwörter',
          'Passwort Generator',
          'Zwei-Faktor-Authentifizierung',
          '2FA',
          'AES-256 Verschlüsselung',
        ]}
        structuredData={structuredData}
      />
      <Header />
      <main className="flex-1">
        <Hero />
        <SecurityFeatures />
        <Features />
        <PWASection />
        <OpenSource />
        <Comparison />
      </main>
      <Footer />
    </div>
  );
}
