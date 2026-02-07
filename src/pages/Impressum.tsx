
import React from "react";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";

const Impressum = () => {
    return (
        <div className="min-h-screen bg-background flex flex-col">
            <Header />
            <main className="flex-grow flex flex-col items-center py-32 px-4 sm:px-6 lg:px-8">
                <div className="w-full max-w-2xl space-y-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold tracking-tight">Impressum</h1>
                    </div>

                    <div className="prose prose-invert max-w-none space-y-6 bg-card p-8 rounded-lg border border-border/50 shadow-sm">
                        <section>
                            <h2 className="text-xl font-semibold mb-4 text-primary">Angaben gemäß § 5 TMG</h2>
                            <div className="space-y-2 text-muted-foreground">
                                <p className="font-medium text-foreground">MDC Management</p>
                                <p>Maik Hädrich</p>
                                <p>Welserstraße 3</p>
                                <p>87463 Dietmannsried</p>
                                <p>Deutschland</p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold mb-4 text-primary">Kontakt</h2>
                            <div className="space-y-2 text-muted-foreground">
                                <p>
                                    <span className="font-medium text-foreground">E-Mail:</span>{" "}
                                    <a href="mailto:kontakt@mauntingstudios.de" className="hover:text-primary transition-colors">
                                        kontakt@mauntingstudios.de
                                    </a>
                                </p>
                                <p className="text-sm italic mt-4">
                                    Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.
                                </p>
                            </div>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold mb-4 text-primary">Rechtsform</h2>
                            <div className="space-y-2 text-muted-foreground">
                                <p>Einzelunternehmer</p>
                            </div>
                        </section>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
};

export default Impressum;
