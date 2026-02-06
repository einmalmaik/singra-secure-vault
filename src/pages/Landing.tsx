/**
 * @fileoverview Landing Page
 * 
 * Public landing page showcasing Singra PW features.
 */

import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import { SecurityFeatures } from '@/components/landing/SecurityFeatures';
import { Features } from '@/components/landing/Features';
import { OpenSource } from '@/components/landing/OpenSource';
import { Comparison } from '@/components/landing/Comparison';
import { Footer } from '@/components/landing/Footer';

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <SecurityFeatures />
        <Features />
        <OpenSource />
        <Comparison />
      </main>
      <Footer />
    </div>
  );
}
