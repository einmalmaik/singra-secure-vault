// Copyright (c) 2025-2026 Maunting Studios
// Licensed under the Business Source License 1.1 - see LICENSE

import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Footer } from "@/components/landing/Footer";
import { Header } from "@/components/landing/Header";
import { DesktopSubpageFrame } from "@/components/layout/DesktopSubpageFrame";
import { SEO } from "@/components/SEO";
import { shouldShowWebsiteChrome } from "@/platform/appShell";
import { LegalDocumentViewer, type LegalDocumentData } from "@/components/LegalDocumentViewer";

const PrivacyPolicy = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const showWebsiteChrome = shouldShowWebsiteChrome();
  const language = i18n.language === 'en' ? 'en' : 'de';

  const sections = [
    {
      heading: t("privacy.general.title"),
      body: t("privacy.general.content"),
    },
    {
      heading: t("privacy.collection.title"),
      body: t("privacy.collection.content"),
    },
    {
      heading: t("privacy.security.title"),
      body: t("privacy.security.content"),
    },
    {
      heading: t("privacy.storage.title"),
      body: t("privacy.storage.content"),
    },
    {
      heading: t("privacy.cookies.title"),
      body: t("privacy.cookies.content"),
    },
    {
      heading: t("privacy.rights.title"),
      body: t("privacy.rights.content"),
    },
  ];

  const documentData: LegalDocumentData = {
    title: t("privacy.title"),
    intro: t("privacy.subtitle"),
    callout: t("privacy.zeroKnowledge.details"),
    lastUpdated: "2026-07-13",
    version: "1.1.0",
    meta: {
      de: t("privacy.zeroKnowledge.title") + " — " + t("privacy.zeroKnowledge.description"),
      en: t("privacy.zeroKnowledge.title") + " — " + t("privacy.zeroKnowledge.description"),
    },
    sections: sections,
  };

  const viewer = (
    <LegalDocumentViewer
      document={documentData}
      language={language}
      onBack={showWebsiteChrome ? () => navigate('/') : () => navigate(-1)}
    />
  );

  return (
    <>
      <SEO
        title="Datenschutzerklaerung"
        description="Datenschutzerklaerung von Singra Vault. Erfahre, wie wir deine Daten schuetzen."
        path="/privacy"
        keywords={[
          "Datenschutz",
          "Datenschutzerklaerung",
          "Privacy Policy",
          "DSGVO",
          "clientseitige Verschlüsselung",
          "Datenverarbeitung",
        ]}
      />

      {showWebsiteChrome ? (
        <div className="sv-public-page min-h-screen bg-background flex flex-col">
          <Header />
          <div className="flex-1">
            {viewer}
          </div>
          <Footer />
        </div>
      ) : (
        <DesktopSubpageFrame
          title={t("privacy.title")}
          description={t("privacy.subtitle")}
          defaultBackTo="/settings?tab=data-legal"
        >
          {viewer}
        </DesktopSubpageFrame>
      )}
    </>
  );
};

export default PrivacyPolicy;
